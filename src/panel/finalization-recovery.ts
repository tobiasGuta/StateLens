import type {
  CaptureContext,
  CaptureDrainSummary,
  WorkflowFinalizationResult,
} from "../shared/types";

export interface FinalizationRecoveryState {
  context: CaptureContext;
  summary: CaptureDrainSummary;
  endedAt: string;
  error: string;
}

interface WorkflowFinalizer {
  finalizeWorkflow(
    workflowId: string,
    options: { endedAt: string; interrupted?: boolean },
  ): Promise<WorkflowFinalizationResult>;
}

export type FinalizationAttempt =
  | { state: "completed"; result: WorkflowFinalizationResult }
  | { state: "finalization-error"; recovery: FinalizationRecoveryState };

export async function attemptWorkflowFinalization(
  finalizer: WorkflowFinalizer,
  context: CaptureContext,
  summary: CaptureDrainSummary,
  endedAt: string,
): Promise<FinalizationAttempt> {
  try {
    return {
      state: "completed",
      result: await finalizer.finalizeWorkflow(context.workflow.id, { endedAt }),
    };
  } catch (error) {
    return {
      state: "finalization-error",
      recovery: {
        context,
        summary,
        endedAt,
        error: error instanceof Error ? error.message : "Unexpected workflow finalization failure",
      },
    };
  }
}
