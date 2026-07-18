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
  it("creates the version-one stores and reads validated project data", async () => {
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
