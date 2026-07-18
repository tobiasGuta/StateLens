import type { ActionMarker } from "../shared/schemas";
import type { MarkerActivationResult } from "../shared/types";

export function mergeMarkerActivation(
  current: ActionMarker[],
  result: MarkerActivationResult,
): ActionMarker[] {
  const changed = new Map<string, ActionMarker>();
  for (const marker of current) changed.set(marker.id, marker);
  if (result.endedPreviousMarker) {
    changed.set(result.endedPreviousMarker.id, result.endedPreviousMarker);
  }
  changed.set(result.activeMarker.id, result.activeMarker);
  return [...changed.values()].sort((left, right) => {
    const timeOrder = left.startedAt.localeCompare(right.startedAt);
    return timeOrder || left.id.localeCompare(right.id);
  });
}

export function mergeEndedMarkers(
  current: ActionMarker[],
  endedMarkers: ActionMarker[],
): ActionMarker[] {
  const changed = new Map(current.map((marker) => [marker.id, marker]));
  for (const marker of endedMarkers) changed.set(marker.id, marker);
  return [...changed.values()].sort((left, right) => {
    const timeOrder = left.startedAt.localeCompare(right.startedAt);
    return timeOrder || left.id.localeCompare(right.id);
  });
}
