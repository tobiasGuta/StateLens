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

export interface ProjectBundle {
  exportedAt: string;
  formatVersion: 1;
  project: Project;
  accountContexts: AccountContext[];
  workflows: Workflow[];
  actionMarkers: ActionMarker[];
  observations: RequestObservation[];
}

export type { AccountContext, ActionMarker, Project, RequestObservation, ScopeRule, Workflow };
