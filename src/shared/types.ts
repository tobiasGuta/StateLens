import type {
  AccountContext,
  ActionMarker,
  Project,
  RequestObservation,
  ScopeRule,
  Workflow,
} from "./schemas";

export interface ScopeValidationResult {
  allowed: boolean;
  matchedRuleId?: string;
  reason: string;
  normalizedHost?: string;
}

export interface BodyParseResult {
  metadata: RequestObservation["requestBodyMetadata"];
  parsed?: unknown;
  sanitizedText?: string;
  redacted: boolean;
  errors: RequestObservation["captureErrors"];
}

export interface CaptureContext {
  project: Project;
  workflow: Workflow;
  accountContext: AccountContext;
  activeMarker?: ActionMarker;
}

export interface IgnoredRequestSummary {
  count: number;
  hostnames: string[];
}

export interface CaptureDrainSummary {
  sessionId: string;
  completed: number;
  timedOut: number;
  discarded: number;
  failed: number;
  ignoredOutOfScope: number;
}

export type CaptureState = "idle" | "recording" | "stopping" | "finalization-error";

export interface MarkerActivationResult {
  workflow: Workflow;
  activeMarker: ActionMarker;
  endedPreviousMarker?: ActionMarker;
}

export interface WorkflowFinalizationResult {
  workflow: Workflow;
  endedMarkers: ActionMarker[];
}

export interface InterruptedWorkflowCandidate {
  workflow: Workflow;
  observationCount: number;
  openMarkerCount: number;
}

export interface ProjectBundle {
  exportedAt: string;
  formatVersion: 1;
  project: Project;
  accountContexts: AccountContext[];
  workflows: Workflow[];
  actionMarkers: ActionMarker[];
  observations: RequestObservation[];
}

export interface ExportReceipt {
  filename: string;
  sha256: string;
  byteSize: number;
}

export interface ProjectRecordCounts {
  projects: number;
  accountContexts: number;
  workflows: number;
  actionMarkers: number;
  observations: number;
}

export type { AccountContext, ActionMarker, Project, RequestObservation, ScopeRule, Workflow };
