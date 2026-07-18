import { openDB, type DBSchema, type IDBPDatabase } from "idb";
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
import type { ProjectRecordCounts } from "../shared/types";

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

export class StateLensRepository {
  constructor(private readonly database: IDBPDatabase<StateLensDatabase>) {}

  static async open(name = DATABASE_NAME): Promise<StateLensRepository> {
    const database = await openDB<StateLensDatabase>(name, DATABASE_VERSION, {
      upgrade(db, oldVersion) {
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

  async activateActionMarker(marker: ActionMarker, previousMarkerId?: string): Promise<Workflow> {
    const validMarker = actionMarkerSchema.parse(marker);
    const transaction = this.database.transaction(["actionMarkers", "workflows"], "readwrite");
    const workflow = await transaction.objectStore("workflows").get(marker.workflowId);
    if (!workflow || workflow.status !== "recording") {
      throw new Error("Action markers can only be added to the active recording workflow");
    }
    if (previousMarkerId) {
      const previous = await transaction.objectStore("actionMarkers").get(previousMarkerId);
      if (previous && previous.workflowId === workflow.id && !previous.endedAt) {
        await transaction
          .objectStore("actionMarkers")
          .put(actionMarkerSchema.parse({ ...previous, endedAt: marker.startedAt }));
      }
    }
    if (!workflow.markerIds.includes(marker.id)) workflow.markerIds.push(marker.id);
    await transaction.objectStore("actionMarkers").put(validMarker);
    await transaction.objectStore("workflows").put(workflowSchema.parse(workflow));
    await transaction.done;
    return workflow;
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
    return this.readValidated("observations", values, requestObservationSchema);
  }

  async listProjectObservations(projectId: string): Promise<RequestObservation[]> {
    const values = await this.database.getAllFromIndex("observations", "projectId", projectId);
    return this.readValidated("observations", values, requestObservationSchema);
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
