import { useState, type FormEvent } from "react";
import type { Workflow } from "../../shared/schemas";

interface RecorderBarProps {
  workflow?: Workflow | undefined;
  canRecord: boolean;
  ignoredCount: number;
  storageBytes: number;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onMarker: (label: string, notes?: string) => Promise<void>;
}

export function RecorderBar(props: RecorderBarProps) {
  const [showMarker, setShowMarker] = useState(false);
  const isRecording = props.workflow?.status === "recording";
  return (
    <div className={isRecording ? "recorder recording" : "recorder"}>
      <div className="recording-state">
        <span className="status-dot" />
        <div>
          <strong>{isRecording ? "Recording" : "Recorder idle"}</strong>
          <small>{props.workflow?.name ?? "Select a workflow"}</small>
        </div>
      </div>
      <div className="recorder-metrics">
        <span>{props.workflow?.observationIds.length ?? 0} requests</span>
        <span>{props.ignoredCount} ignored</span>
        <span>{formatBytes(props.storageBytes)} local</span>
      </div>
      <div className="recorder-actions">
        {!isRecording ? (
          <button
            className="primary"
            type="button"
            disabled={!props.canRecord}
            onClick={() => void props.onStart()}
          >
            Start recording
          </button>
        ) : (
          <button className="danger" type="button" onClick={() => void props.onStop()}>
            Stop recording
          </button>
        )}
        <button
          type="button"
          disabled={!isRecording}
          onClick={() => setShowMarker((current) => !current)}
        >
          Add action marker
        </button>
      </div>
      {showMarker && isRecording && (
        <form
          className="marker-form"
          onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const labelValue = data.get("label");
            const notesValue = data.get("notes");
            const label = typeof labelValue === "string" ? labelValue.trim() : "";
            const notes = typeof notesValue === "string" ? notesValue.trim() : "";
            if (label) void props.onMarker(label, notes || undefined);
            event.currentTarget.reset();
            setShowMarker(false);
          }}
        >
          <input required autoFocus name="label" placeholder="Clicked Apply coupon" />
          <input name="notes" placeholder="Optional note" />
          <button type="submit">Mark now</button>
        </form>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
