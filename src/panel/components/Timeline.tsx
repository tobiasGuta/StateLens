import type { ActionMarker, RequestObservation } from "../../shared/schemas";

interface TimelineProps {
  observations: RequestObservation[];
  markers: ActionMarker[];
  selectedId?: string | undefined;
  onSelect: (observation: RequestObservation) => void;
}

type TimelineEntry =
  | { type: "marker"; timestamp: string; sequence: 0; marker: ActionMarker }
  | {
      type: "observation";
      timestamp: string;
      sequence: number;
      observation: RequestObservation;
    };

export function Timeline({ observations, markers, selectedId, onSelect }: TimelineProps) {
  const entries: TimelineEntry[] = [
    ...markers.map((marker): TimelineEntry => ({
      type: "marker",
      timestamp: marker.startedAt,
      sequence: 0,
      marker,
    })),
    ...observations.map((observation): TimelineEntry => ({
      type: "observation",
      timestamp: observation.timestamp,
      sequence: observation.sessionSequence,
      observation,
    })),
  ].sort((left, right) => {
    const timestampOrder = left.timestamp.localeCompare(right.timestamp);
    return timestampOrder || left.sequence - right.sequence;
  });

  if (entries.length === 0)
    return (
      <div className="empty-state">
        <h2>No captured evidence yet</h2>
        <p>
          Open DevTools before the page loads, select a scoped workflow, start recording, and reload
          the inspected page.
        </p>
      </div>
    );
  return (
    <div className="timeline-list" aria-label="Workflow timeline">
      {entries.map((entry) => {
        const time = new Date(entry.timestamp).toLocaleTimeString([], { hour12: false });
        if (entry.type === "marker")
          return (
            <div className="timeline-entry marker" key={entry.marker.id}>
              <time>{time}</time>
              <span className="entry-kind">ACTION</span>
              <strong>{entry.marker.label}</strong>
              {entry.marker.notes && <small>{entry.marker.notes}</small>}
            </div>
          );
        const item = entry.observation;
        return (
          <button
            className={
              selectedId === item.id ? "timeline-entry request selected" : "timeline-entry request"
            }
            onClick={() => onSelect(item)}
            key={item.id}
            type="button"
          >
            <time>{time}</time>
            <span className={`method method-${item.method.toLowerCase()}`}>{item.method}</span>
            <strong>{item.path}</strong>
            <span className={`status status-${Math.floor(item.responseStatus / 100)}`}>
              {item.responseStatus}
            </span>
            <small>
              #{item.sessionSequence} · {item.host} · {item.durationMs.toFixed(0)} ms
            </small>
            {item.redactionStatus === "redacted" && <span className="pill">redacted</span>}
            {item.truncationStatus !== "none" && <span className="pill warn">limited</span>}
          </button>
        );
      })}
    </div>
  );
}
