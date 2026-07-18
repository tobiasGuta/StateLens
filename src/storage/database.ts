import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";
import { DATABASE_NAME, DATABASE_VERSION } from "../shared/constants";
import {
  accountContextSchema,
  actionMarkerSchema,
  projectSchema,
  recoverableStorageErrorSchema,
  requestObservationSchema,
  workflowSchema,
  type AccountContext,
  type ActionMarker,
  type Project,
  type RecoverableStorageError,
  type RequestObservation,
  type Workflow,
} from "../shared/schemas";
import type { ZodType } from "zod";
import { compareObservations, compareWorkflowObservations } from "../shared/observation-order";
import type {
  InterruptedWorkflowCandidate,
  MarkerActivationResult,
  ProjectRecordCounts,
  WorkflowFinalizationResult,
} from "../shared/types";

interface StateLensDatabase extends DBSchema {
  projects: { key: string; value: Project };
  accountContexts: { key: string; value: AccountContext; indexes: { projectId: string } };
  workflows: {
    key: string;
    value: Workflow;
    indexes: { projectId: string; accountContextId: string };
  };
  actionMarkers: { key: string; value: ActionMarker; indexes: { workflowId: string } };
  observations: {
    key: string;
    value: RequestObservation;
    indexes: { projectId: string; workflowId: string };
  };
  recoverableErrors: {
    key: string;
    value: RecoverableStorageError;
    indexes: { storeName: string };
  };
}

type ValidatedStore =
  "projects" | "accountContexts" | "workflows" | "actionMarkers" | "observations";

type UpgradeTransaction = IDBPTransaction<
  StateLensDatabase,
  ArrayLike<
    | "projects"
    | "accountContexts"
    | "workflows"
    | "actionMarkers"
    | "observations"
    | "recoverableErrors"
  >,
  "versionchange"
>;

async function migrateObservationsToVersionTwo(transaction: UpgradeTransaction): Promise<void> {
  const observationStore = transaction.objectStore("observations");
  const errorStore = transaction.objectStore("recoverableErrors");
  const rawObservations = (await observationStore.getAll()) as unknown[];
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const value of rawObservations) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const workflowId = typeof record.workflowId === "string" ? record.workflowId : "";
    const group = grouped.get(workflowId) ?? [];
    group.push(record);
    grouped.set(workflowId, group);
  }
  for (const records of grouped.values()) {
    records.sort((left, right) => {
      const leftTimestamp = typeof left.timestamp === "string" ? left.timestamp : "";
      const rightTimestamp = typeof right.timestamp === "string" ? right.timestamp : "";
      const timestampOrder = leftTimestamp.localeCompare(rightTimestamp);
      if (timestampOrder) return timestampOrder;
      const leftId = typeof left.id === "string" ? left.id : "";
      const rightId = typeof right.id === "string" ? right.id : "";
      return leftId.localeCompare(rightId);
    });
    for (const [index, record] of records.entries()) {
      const migrated = { ...record, sessionSequence: index + 1 };
      const result = requestObservationSchema.safeParse(migrated);
      if (result.success) {
        await observationStore.put(result.data);
      } else {
        await errorStore.put(
          recoverableStorageErrorSchema.parse({
            id: crypto.randomUUID(),
            storeName: "observations",
            ...(typeof record.id === "string" ? { recordId: record.id } : {}),
            message: `Version 2 migration: ${result.error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; ")}`,
            detectedAt: new Date().toISOString(),
          }),
        );
      }
    }
  }
}

export class StateLensRepository {
  constructor(private readonly database: IDBPDatabase<StateLensDatabase>) {}

  static async open(name = DATABASE_NAME): Promise<StateLensRepository> {
    const database = await openDB<StateLensDatabase>(name, DATABASE_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          db.createObjectStore("projects", { keyPath: "id" });
          const accounts = db.createObjectStore("accountContexts", { keyPath: "id" });
          accounts.createIndex("projectId", "projectId");
          const workflows = db.createObjectStore("workflows", { keyPath: "id" });
          workflows.createIndex("projectId", "projectId");
          workflows.createIndex("accountContextId", "accountContextId");
          const markers = db.createObjectStore("actionMarkers", { keyPath: "id" });
          markers.createIndex("workflowId", "workflowId");
          const observations = db.createObjectStore("observations", { keyPath: "id" });
          observations.createIndex("projectId", "projectId");
          observations.createIndex("workflowId", "workflowId");
          const errors = db.createObjectStore("recoverableErrors", { keyPath: "id" });
          errors.createIndex("storeName", "storeName");
        }
        if (oldVersion < 2) {
          void migrateObservationsToVersionTwo(transaction).catch(() => transaction.abort());
        }
      },
    });
    return new StateLensRepository(database);
  }

  close(): void {
    this.database.close();
  }

  async putProject(project: Project): Promise<void> {
    await this.database.put("projects", projectSchema.parse(project));
  }

  async putAccountContext(account: AccountContext): Promise<void> {
    await this.database.put("accountContexts", accountContextSchema.parse(account));
  }

  async putWorkflow(workflow: Workflow): Promise<void> {
    await this.database.put("workflows", workflowSchema.parse(workflow));
  }

  async putActionMarker(marker: ActionMarker): Promise<void> {
    await this.database.put("actionMarkers", actionMarkerSchema.parse(marker));
  }

  async activateActionMarker(
    marker: ActionMarker,
    previousMarkerId?: string,
  ): Promise<MarkerActivationResult> {
    const validMarker = actionMarkerSchema.parse(marker);
    if (previousMarkerId === validMarker.id) {
      throw new Error("A replacement marker must have a new identity");
    }
    const transaction = this.database.transaction(["actionMarkers", "workflows"], "readwrite");
    const workflow = await transaction.objectStore("workflows").get(validMarker.workflowId);
    if (!workflow || workflow.status !== "recording") {
      throw new Error("Action markers can only be added to the active recording workflow");
    }
    let endedPreviousMarker: ActionMarker | undefined;
    if (previousMarkerId) {
      const previous = await transaction.objectStore("actionMarkers").get(previousMarkerId);
      if (!previous || previous.workflowId !== workflow.id) {
        throw new Error("The previous marker does not belong to the recording workflow");
      }
      endedPreviousMarker = actionMarkerSchema.parse({
        ...previous,
        endedAt: previous.endedAt ?? validMarker.startedAt,
      });
    }
    const updatedWorkflow = workflowSchema.parse({
      ...workflow,
      markerIds: workflow.markerIds.includes(validMarker.id)
        ? workflow.markerIds
        : [...workflow.markerIds, validMarker.id],
    });
    if (endedPreviousMarker) {
      await transaction.objectStore("actionMarkers").put(endedPreviousMarker);
    }
    await transaction.objectStore("actionMarkers").put(validMarker);
    await transaction.objectStore("workflows").put(updatedWorkflow);
    await transaction.done;
    return {
      workflow: updatedWorkflow,
      activeMarker: validMarker,
      ...(endedPreviousMarker ? { endedPreviousMarker } : {}),
    };
  }

  async endActionMarker(markerId: string, workflowId: string): Promise<ActionMarker> {
    const transaction = this.database.transaction(["actionMarkers", "workflows"], "readwrite");
    const [marker, workflow] = await Promise.all([
      transaction.objectStore("actionMarkers").get(markerId),
      transaction.objectStore("workflows").get(workflowId),
    ]);
    if (
      !marker ||
      marker.workflowId !== workflowId ||
      !workflow ||
      workflow.status !== "recording"
    ) {
      throw new Error("The active marker does not belong to the recording workflow");
    }
    const ended = actionMarkerSchema.parse({
      ...marker,
      endedAt: marker.endedAt ?? new Date().toISOString(),
    });
    await transaction.objectStore("actionMarkers").put(ended);
    await transaction.done;
    return ended;
  }

  async appendObservation(observation: RequestObservation): Promise<Workflow> {
    const validObservation = requestObservationSchema.parse(observation);
    const transaction = this.database.transaction(["observations", "workflows"], "readwrite");
    const workflow = await transaction.objectStore("workflows").get(observation.workflowId);
    if (!workflow) {
      throw new Error("Cannot store an observation for a missing workflow");
    }
    if (workflow.status !== "recording") {
      throw new Error("Cannot store an observation after workflow recording has ended");
    }
    if (!workflow.observationIds.includes(observation.id))
      workflow.observationIds.push(observation.id);
    await transaction.objectStore("observations").put(validObservation);
    await transaction.objectStore("workflows").put(workflowSchema.parse(workflow));
    await transaction.done;
    return workflow;
  }

  async getWorkflow(workflowId: string): Promise<Workflow | undefined> {
    const value = await this.database.get("workflows", workflowId);
    if (!value) return undefined;
    const result = workflowSchema.safeParse(value);
    if (result.success) return result.data;
    await this.recordRecoverableError({
      id: crypto.randomUUID(),
      storeName: "workflows",
      recordId: workflowId,
      message: result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
      detectedAt: new Date().toISOString(),
    });
    return undefined;
  }

  async listInterruptedWorkflows(): Promise<InterruptedWorkflowCandidate[]> {
    const workflows = (
      await this.readValidated("workflows", await this.database.getAll("workflows"), workflowSchema)
    ).filter((workflow) => workflow.status === "recording");
    return Promise.all(
      workflows.map(async (workflow) => {
        const [observations, markers] = await Promise.all([
          this.database.getAllFromIndex("observations", "workflowId", workflow.id),
          this.database.getAllFromIndex("actionMarkers", "workflowId", workflow.id),
        ]);
        return {
          workflow,
          observationCount: observations.length,
          openMarkerCount: markers.filter((marker) => !marker.endedAt).length,
        };
      }),
    );
  }

  async finalizeWorkflow(
    workflowId: string,
    options: { endedAt: string; interrupted?: boolean },
  ): Promise<WorkflowFinalizationResult> {
    const transaction = this.database.transaction(
      ["workflows", "observations", "actionMarkers"],
      "readwrite",
    );
    const workflow = await transaction.objectStore("workflows").get(workflowId);
    if (!workflow) throw new Error("Cannot finalize a missing workflow");
    if (workflow.status !== "recording" && workflow.status !== "completed") {
      throw new Error("Only recording or completed workflows can be finalized");
    }
    const observations = await transaction
      .objectStore("observations")
      .index("workflowId")
      .getAll(workflowId);
    const validObservations = observations.map((observation) =>
      requestObservationSchema.parse(observation),
    );
    validObservations.sort(compareWorkflowObservations);
    const markers = await transaction
      .objectStore("actionMarkers")
      .index("workflowId")
      .getAll(workflowId);
    const validMarkers = markers.map((marker) => actionMarkerSchema.parse(marker));
    const finalEndedAt = workflow.endedAt ?? options.endedAt;
    const endedMarkers = validMarkers
      .filter((marker) => !marker.endedAt)
      .map((marker) => actionMarkerSchema.parse({ ...marker, endedAt: finalEndedAt }));
    const updated = workflowSchema.parse({
      ...workflow,
      status: "completed",
      endedAt: finalEndedAt,
      observationIds: validObservations.map((observation) => observation.id),
      ...(options.interrupted
        ? {
            recovery: {
              reason: "capture-interrupted",
              detectedAt: workflow.recovery?.detectedAt ?? options.endedAt,
              finalizedAt: finalEndedAt,
            },
          }
        : {}),
    });
    for (const marker of endedMarkers) {
      await transaction.objectStore("actionMarkers").put(marker);
    }
    await transaction.objectStore("workflows").put(updated);
    await transaction.done;
    return { workflow: updated, endedMarkers };
  }

  async discardEmptyInterruptedWorkflow(workflowId: string): Promise<void> {
    const transaction = this.database.transaction(
      ["workflows", "observations", "actionMarkers"],
      "readwrite",
    );
    const workflow = await transaction.objectStore("workflows").get(workflowId);
    if (!workflow || workflow.status !== "recording") {
      throw new Error("Only an interrupted recording workflow can be discarded");
    }
    const observations = await transaction
      .objectStore("observations")
      .index("workflowId")
      .getAllKeys(workflowId);
    if (observations.length > 0) {
      throw new Error("A non-empty interrupted workflow cannot be discarded");
    }
    const markerStore = transaction.objectStore("actionMarkers");
    const markerKeys = await markerStore.index("workflowId").getAllKeys(workflowId);
    for (const key of markerKeys) await markerStore.delete(key);
    await transaction.objectStore("workflows").delete(workflowId);
    await transaction.done;
  }

  async listProjects(): Promise<Project[]> {
    return this.readValidated("projects", await this.database.getAll("projects"), projectSchema);
  }

  async listAccountContexts(projectId: string): Promise<AccountContext[]> {
    const values = await this.database.getAllFromIndex("accountContexts", "projectId", projectId);
    return this.readValidated("accountContexts", values, accountContextSchema);
  }

  async listWorkflows(projectId: string): Promise<Workflow[]> {
    const values = await this.database.getAllFromIndex("workflows", "projectId", projectId);
    return this.readValidated("workflows", values, workflowSchema);
  }

  async listActionMarkers(workflowId: string): Promise<ActionMarker[]> {
    const values = await this.database.getAllFromIndex("actionMarkers", "workflowId", workflowId);
    return this.readValidated("actionMarkers", values, actionMarkerSchema);
  }

  async listObservations(workflowId: string): Promise<RequestObservation[]> {
    const values = await this.database.getAllFromIndex("observations", "workflowId", workflowId);
    return (await this.readValidated("observations", values, requestObservationSchema)).sort(
      compareWorkflowObservations,
    );
  }

  async listProjectObservations(projectId: string): Promise<RequestObservation[]> {
    const values = await this.database.getAllFromIndex("observations", "projectId", projectId);
    return (await this.readValidated("observations", values, requestObservationSchema)).sort(
      compareObservations,
    );
  }

  async listRecoverableErrors(): Promise<RecoverableStorageError[]> {
    const values = await this.database.getAll("recoverableErrors");
    return values.flatMap((value) => {
      const result = recoverableStorageErrorSchema.safeParse(value);
      return result.success ? [result.data] : [];
    });
  }

  async purgeProject(projectId: string): Promise<void> {
    const storeNames = [
      "projects",
      "accountContexts",
      "workflows",
      "actionMarkers",
      "observations",
    ] as const;
    const transaction = this.database.transaction(storeNames, "readwrite");
    const workflows = await transaction
      .objectStore("workflows")
      .index("projectId")
      .getAll(projectId);
    const workflowIds = new Set(workflows.map((workflow) => workflow.id));
    const accountStore = transaction.objectStore("accountContexts");
    const workflowStore = transaction.objectStore("workflows");
    const observationStore = transaction.objectStore("observations");
    const [accountKeys, workflowKeys, observationKeys] = await Promise.all([
      accountStore.index("projectId").getAllKeys(projectId),
      workflowStore.index("projectId").getAllKeys(projectId),
      observationStore.index("projectId").getAllKeys(projectId),
    ]);
    await transaction.objectStore("projects").delete(projectId);
    for (const key of accountKeys) await accountStore.delete(key);
    for (const key of workflowKeys) await workflowStore.delete(key);
    for (const key of observationKeys) await observationStore.delete(key);
    const markers = transaction.objectStore("actionMarkers");
    for (const workflowId of workflowIds) {
      const keys = await markers.index("workflowId").getAllKeys(workflowId);
      for (const key of keys) await markers.delete(key);
    }
    await transaction.done;
  }

  async estimateProjectBytes(projectId: string): Promise<number> {
    const [projects, accounts, workflows, observations] = await Promise.all([
      this.listProjects(),
      this.listAccountContexts(projectId),
      this.listWorkflows(projectId),
      this.listProjectObservations(projectId),
    ]);
    const project = projects.find((candidate) => candidate.id === projectId);
    const markers = (
      await Promise.all(workflows.map((workflow) => this.listActionMarkers(workflow.id)))
    ).flat();
    return new Blob([JSON.stringify({ project, accounts, workflows, markers, observations })]).size;
  }

  async getProjectRecordCounts(projectId: string): Promise<ProjectRecordCounts> {
    const [projects, accountContexts, workflows, observations] = await Promise.all([
      this.listProjects(),
      this.listAccountContexts(projectId),
      this.listWorkflows(projectId),
      this.listProjectObservations(projectId),
    ]);
    const actionMarkers = (
      await Promise.all(workflows.map((workflow) => this.listActionMarkers(workflow.id)))
    ).flat();
    return {
      projects: projects.some((project) => project.id === projectId) ? 1 : 0,
      accountContexts: accountContexts.length,
      workflows: workflows.length,
      actionMarkers: actionMarkers.length,
      observations: observations.length,
    };
  }

  private async readValidated<T>(
    storeName: ValidatedStore,
    values: unknown[],
    schema: ZodType<T>,
  ): Promise<T[]> {
    const records: T[] = [];
    for (const value of values) {
      const result = schema.safeParse(value);
      if (result.success) {
        records.push(result.data);
      } else {
        const record =
          value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
        await this.recordRecoverableError({
          id: crypto.randomUUID(),
          storeName,
          ...(typeof record?.id === "string" ? { recordId: record.id } : {}),
          message: result.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; "),
          detectedAt: new Date().toISOString(),
        });
      }
    }
    return records;
  }

  private async recordRecoverableError(error: RecoverableStorageError): Promise<void> {
    await this.database.put("recoverableErrors", recoverableStorageErrorSchema.parse(error));
  }
}
