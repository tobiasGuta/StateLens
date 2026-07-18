import type { RequestObservation } from "./schemas";

export function compareObservations(left: RequestObservation, right: RequestObservation): number {
  return (
    left.timestamp.localeCompare(right.timestamp) ||
    left.workflowId.localeCompare(right.workflowId) ||
    left.sessionSequence - right.sessionSequence ||
    left.id.localeCompare(right.id)
  );
}

export function compareWorkflowObservations(
  left: RequestObservation,
  right: RequestObservation,
): number {
  return (
    left.timestamp.localeCompare(right.timestamp) ||
    left.sessionSequence - right.sessionSequence ||
    left.workflowId.localeCompare(right.workflowId) ||
    left.id.localeCompare(right.id)
  );
}
