import type { RequestObservation } from "./schemas";

export function compareObservations(left: RequestObservation, right: RequestObservation): number {
  const timestampOrder = left.timestamp.localeCompare(right.timestamp);
  return timestampOrder || left.sessionSequence - right.sessionSequence;
}
