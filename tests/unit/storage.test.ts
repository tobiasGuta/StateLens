import { afterEach, describe, expect, it } from "vitest";
import { StateLensRepository } from "../../src/storage/database";
import { fixtureObservation, fixtureProject, fixtureWorkflow } from "../fixtures/records";

const openedNames: string[] = [];
const databaseName = (): string => {
  const name = `statelens-test-${crypto.randomUUID()}`;
  openedNames.push(name);
  return name;
};

afterEach(async () => {
  await Promise.all(
    openedNames.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error ?? new Error("Database deletion failed"));
        }),
    ),
  );
});

describe("IndexedDB repository", () => {
  it("creates the current stores and reads validated project data", async () => {
    const name = databaseName();
    const repository = await StateLensRepository.open(name);
    const project = fixtureProject();
    await repository.putProject(project);
    expect(await repository.listProjects()).toEqual([project]);
    repository.close();
    const database = await openNative(name);
    expect([...database.objectStoreNames]).toEqual(
      expect.arrayContaining(["projects", "workflows", "observations", "recoverableErrors"]),
    );
    database.close();
  });

  it("migrates version-one observations with stable fallback sequence numbers", async () => {
    const name = databaseName();
    const oldDatabase = await createVersionOneDatabase(name);
    const first = fixtureObservation({ id: "observation-b" });
    const second = fixtureObservation({ id: "observation-a" });
    const oldFirst: Record<string, unknown> = { ...first };
    const oldSecond: Record<string, unknown> = { ...second };
    delete oldFirst.sessionSequence;
    delete oldSecond.sessionSequence;
    const transaction = oldDatabase.transaction("observations", "readwrite");
    transaction.objectStore("observations").put(oldFirst);
    transaction.objectStore("observations").put(oldSecond);
    await transactionComplete(transaction);
    oldDatabase.close();

    const repository = await StateLensRepository.open(name);
    const migrated = await repository.listObservations("workflow-1");
    expect(migrated.map((observation) => [observation.id, observation.sessionSequence])).toEqual([
      ["observation-a", 1],
      ["observation-b", 2],
    ]);
    repository.close();
  });

  it("records a recoverable migration error without deleting an invalid old observation", async () => {
    const name = databaseName();
    const oldDatabase = await createVersionOneDatabase(name);
    const transaction = oldDatabase.transaction("observations", "readwrite");
    transaction
      .objectStore("observations")
      .put({ id: "broken-observation", workflowId: "workflow-1" });
    await transactionComplete(transaction);
    oldDatabase.close();
    const repository = await StateLensRepository.open(name);
    const recoverableErrors = await repository.listRecoverableErrors();
    expect(recoverableErrors).toHaveLength(1);
    expect(recoverableErrors[0]?.storeName).toBe("observations");
    expect(recoverableErrors[0]?.recordId).toBe("broken-observation");
    expect(recoverableErrors[0]?.message).toContain("Version 2 migration");
    const native = await openNative(name);
    expect(
      await requestResult(
        native
          .transaction("observations", "readonly")
          .objectStore("observations")
          .get("broken-observation"),
      ),
    ).toBeTruthy();
    native.close();
    repository.close();
  });

  it("atomically appends an observation and updates its workflow", async () => {
    const repository = await StateLensRepository.open(databaseName());
    await repository.putProject(fixtureProject());
    await repository.putWorkflow(fixtureWorkflow());
    const updated = await repository.appendObservation(fixtureObservation());
    expect(updated.observationIds).toEqual(["observation-1"]);
    expect(await repository.listObservations("workflow-1")).toHaveLength(1);
    repository.close();
  });

  it("rolls back when an observation references a missing workflow", async () => {
    const repository = await StateLensRepository.open(databaseName());
    await expect(
      repository.appendObservation(fixtureObservation({ workflowId: "missing" })),
    ).rejects.toThrow("missing workflow");
    expect(await repository.listProjectObservations("project-1")).toEqual([]);
    repository.close();
  });

  it("rejects observations after workflow completion", async () => {
    const repository = await StateLensRepository.open(databaseName());
    await repository.putWorkflow(fixtureWorkflow({ status: "completed" }));
    await expect(repository.appendObservation(fixtureObservation())).rejects.toThrow(
      "recording has ended",
    );
    expect(await repository.listObservations("workflow-1")).toEqual([]);
    repository.close();
  });

  it("purges only the selected project and all of its child records", async () => {
    const repository = await StateLensRepository.open(databaseName());
    const other = fixtureProject({ id: "project-2", name: "Keep me" });
    await repository.putProject(fixtureProject());
    await repository.putProject(other);
    await repository.putAccountContext({ id: "account-1", projectId: "project-1", name: "A" });
    await repository.putWorkflow(fixtureWorkflow());
    await repository.appendObservation(fixtureObservation());
    await repository.purgeProject("project-1");
    expect(await repository.listProjects()).toEqual([other]);
    expect(await repository.listProjectObservations("project-1")).toEqual([]);
    repository.close();
  });

  it("isolates an invalid record and writes a recoverable error", async () => {
    const name = databaseName();
    const repository = await StateLensRepository.open(name);
    const database = await openNative(name);
    await requestResult(
      database
        .transaction("projects", "readwrite")
        .objectStore("projects")
        .put({ id: "broken", name: "Missing fields" }),
    );
    expect(await repository.listProjects()).toEqual([]);
    const errors = await repository.listRecoverableErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ storeName: "projects", recordId: "broken" });
    database.close();
    repository.close();
  });

  it("handles a large workflow without losing observation IDs", async () => {
    const repository = await StateLensRepository.open(databaseName());
    await repository.putWorkflow(fixtureWorkflow());
    for (let index = 0; index < 50; index += 1)
      await repository.appendObservation(fixtureObservation({ id: `observation-${index}` }));
    const workflows = await repository.listWorkflows("project-1");
    expect(workflows[0]?.observationIds).toHaveLength(50);
    expect(await repository.listObservations("workflow-1")).toHaveLength(50);
    repository.close();
  });

  it("atomically activates, replaces, and ends markers only for a recording workflow", async () => {
    const repository = await StateLensRepository.open(databaseName());
    await repository.putWorkflow(fixtureWorkflow({ status: "recording" }));
    const first = {
      id: "marker-1",
      workflowId: "workflow-1",
      label: "Clicked checkout",
      startedAt: "2026-07-18T12:00:00.000Z",
    };
    const second = {
      id: "marker-2",
      workflowId: "workflow-1",
      label: "Confirmed order",
      startedAt: "2026-07-18T12:00:01.000Z",
    };
    await repository.activateActionMarker(first);
    const activation = await repository.activateActionMarker(second, first.id);
    expect(activation.workflow.markerIds).toEqual([first.id, second.id]);
    expect(activation.endedPreviousMarker?.endedAt).toBe(second.startedAt);
    const markers = await repository.listActionMarkers("workflow-1");
    expect(markers.find((marker) => marker.id === first.id)?.endedAt).toBe(second.startedAt);
    const ended = await repository.endActionMarker(second.id, "workflow-1");
    expect(ended.endedAt).toBeTruthy();
    const endedAgain = await repository.endActionMarker(second.id, "workflow-1");
    expect(endedAgain.endedAt).toBe(ended.endedAt);
    repository.close();
  });

  it("rejects cross-workflow marker replacement without changing stored records", async () => {
    const repository = await StateLensRepository.open(databaseName());
    await repository.putWorkflow(fixtureWorkflow());
    await repository.putWorkflow(
      fixtureWorkflow({ id: "workflow-2", accountContextId: "account-2" }),
    );
    const otherMarker = {
      id: "other-marker",
      workflowId: "workflow-2",
      label: "Other action",
      startedAt: "2026-07-18T12:00:00.000Z",
    };
    await repository.activateActionMarker(otherMarker);
    await expect(
      repository.activateActionMarker(
        {
          id: "new-marker",
          workflowId: "workflow-1",
          label: "Must roll back",
          startedAt: "2026-07-18T12:00:01.000Z",
        },
        otherMarker.id,
      ),
    ).rejects.toThrow("does not belong");
    expect(await repository.listActionMarkers("workflow-1")).toEqual([]);
    expect((await repository.getWorkflow("workflow-1"))?.markerIds).toEqual([]);
    await expect(repository.endActionMarker(otherMarker.id, "workflow-1")).rejects.toThrow(
      "does not belong",
    );
    repository.close();
  });

  it("leaves marker records unchanged when activation transaction validation fails", async () => {
    const name = databaseName();
    const repository = await StateLensRepository.open(name);
    await repository.putWorkflow(fixtureWorkflow());
    const previous = {
      id: "previous-marker",
      workflowId: "workflow-1",
      label: "Must remain open",
      startedAt: "2026-07-18T12:00:00.000Z",
    };
    await repository.activateActionMarker(previous);

    const native = await openNative(name);
    const corrupting = native.transaction("workflows", "readwrite");
    corrupting.objectStore("workflows").put({ ...fixtureWorkflow(), name: "" });
    await transactionComplete(corrupting);
    await expect(
      repository.activateActionMarker(
        {
          id: "rejected-marker",
          workflowId: "workflow-1",
          label: "Must not be stored",
          startedAt: "2026-07-18T12:00:01.000Z",
        },
        previous.id,
      ),
    ).rejects.toThrow();
    const markerTransaction = native.transaction("actionMarkers", "readonly");
    const markerStore = markerTransaction.objectStore("actionMarkers");
    expect(await requestResult(markerStore.get(previous.id))).toEqual(previous);
    expect(await requestResult(markerStore.get("rejected-marker"))).toBeUndefined();
    await transactionComplete(markerTransaction);
    native.close();
    repository.close();
  });

  it("reconciles and idempotently finalizes interrupted workflow evidence", async () => {
    const repository = await StateLensRepository.open(databaseName());
    await repository.putWorkflow(fixtureWorkflow());
    await repository.appendObservation(fixtureObservation());
    await repository.putWorkflow(fixtureWorkflow({ observationIds: ["stale-id"] }));
    const marker = {
      id: "open-marker",
      workflowId: "workflow-1",
      label: "Open action",
      startedAt: "2026-07-18T12:00:00.500Z",
    };
    await repository.activateActionMarker(marker);
    const endedAt = "2026-07-18T12:01:00.000Z";
    const first = await repository.finalizeWorkflow("workflow-1", {
      endedAt,
      interrupted: true,
    });
    expect(first.workflow).toMatchObject({
      status: "completed",
      endedAt,
      observationIds: ["observation-1"],
      recovery: { reason: "capture-interrupted", finalizedAt: endedAt },
    });
    expect(first.endedMarkers[0]?.endedAt).toBe(endedAt);
    const second = await repository.finalizeWorkflow("workflow-1", {
      endedAt: "2026-07-18T12:02:00.000Z",
      interrupted: true,
    });
    expect(second.workflow.endedAt).toBe(endedAt);
    expect(second.endedMarkers).toEqual([]);
    repository.close();
  });

  it("rolls back marker and workflow changes when finalization transaction validation fails", async () => {
    const name = databaseName();
    const repository = await StateLensRepository.open(name);
    await repository.putWorkflow(fixtureWorkflow());
    const openMarker = {
      id: "a-open-marker",
      workflowId: "workflow-1",
      label: "Must remain open",
      startedAt: "2026-07-18T12:00:00.500Z",
    };
    await repository.activateActionMarker(openMarker);
    const native = await openNative(name);
    await requestResult(
      native.transaction("actionMarkers", "readwrite").objectStore("actionMarkers").put({
        id: "z-invalid-marker",
        workflowId: "workflow-1",
        label: "Invalid",
        startedAt: "not-a-date",
      }),
    );
    native.close();
    await expect(
      repository.finalizeWorkflow("workflow-1", { endedAt: "2026-07-18T12:01:00.000Z" }),
    ).rejects.toThrow();
    expect((await repository.getWorkflow("workflow-1"))?.status).toBe("recording");
    expect(
      (await repository.listActionMarkers("workflow-1")).find(
        (marker) => marker.id === openMarker.id,
      )?.endedAt,
    ).toBeUndefined();
    repository.close();
  });

  it("detects interrupted workflows and only discards an explicitly empty one", async () => {
    const repository = await StateLensRepository.open(databaseName());
    await repository.putWorkflow(fixtureWorkflow({ id: "empty-workflow" }));
    await repository.putWorkflow(fixtureWorkflow({ id: "nonempty-workflow" }));
    await repository.appendObservation(
      fixtureObservation({ id: "kept-observation", workflowId: "nonempty-workflow" }),
    );
    const candidates = await repository.listInterruptedWorkflows();
    expect(
      candidates.find((candidate) => candidate.workflow.id === "empty-workflow")?.observationCount,
    ).toBe(0);
    expect(
      candidates.find((candidate) => candidate.workflow.id === "nonempty-workflow")
        ?.observationCount,
    ).toBe(1);
    await expect(repository.discardEmptyInterruptedWorkflow("nonempty-workflow")).rejects.toThrow(
      "non-empty",
    );
    await repository.discardEmptyInterruptedWorkflow("empty-workflow");
    expect(await repository.getWorkflow("empty-workflow")).toBeUndefined();
    expect(await repository.getWorkflow("nonempty-workflow")).toBeTruthy();
    repository.close();
  });

  it("rejects markers for a completed workflow", async () => {
    const repository = await StateLensRepository.open(databaseName());
    await repository.putWorkflow(fixtureWorkflow({ status: "completed" }));
    await expect(
      repository.activateActionMarker({
        id: "marker-1",
        workflowId: "workflow-1",
        label: "Too late",
        startedAt: "2026-07-18T12:00:00.000Z",
      }),
    ).rejects.toThrow("active recording workflow");
    expect(await repository.listActionMarkers("workflow-1")).toEqual([]);
    repository.close();
  });
});

function openNative(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Database open failed"));
  });
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function createVersionOneDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore("projects", { keyPath: "id" });
      const accounts = database.createObjectStore("accountContexts", { keyPath: "id" });
      accounts.createIndex("projectId", "projectId");
      const workflows = database.createObjectStore("workflows", { keyPath: "id" });
      workflows.createIndex("projectId", "projectId");
      workflows.createIndex("accountContextId", "accountContextId");
      const markers = database.createObjectStore("actionMarkers", { keyPath: "id" });
      markers.createIndex("workflowId", "workflowId");
      const observations = database.createObjectStore("observations", { keyPath: "id" });
      observations.createIndex("projectId", "projectId");
      observations.createIndex("workflowId", "workflowId");
      const errors = database.createObjectStore("recoverableErrors", { keyPath: "id" });
      errors.createIndex("storeName", "storeName");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Old database creation failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Transaction aborted"));
  });
}
