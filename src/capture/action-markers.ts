import type { ActionMarker } from "../shared/schemas";

export function createActionMarker(
  workflowId: string,
  label: string,
  notes?: string,
): ActionMarker {
  return {
    id: crypto.randomUUID(),
    workflowId,
    label: label.trim(),
    ...(notes?.trim() ? { notes: notes.trim() } : {}),
    startedAt: new Date().toISOString(),
  };
}
