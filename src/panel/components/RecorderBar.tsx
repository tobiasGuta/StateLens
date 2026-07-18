import { useState, type FormEvent } from "react";
import type { Workflow } from "../../shared/schemas";
import type { CaptureDrainSummary, CaptureState } from "../../shared/types";
import { useAsyncAction } from "../hooks/use-async-action";

interface RecorderBarProps {
  workflow?: Workflow | undefined;
  canRecord: boolean;
  ignoredCount: number;
  storageBytes: number;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onMarker: (label: string, notes?: string) => Promise<void>;
  onEndMarker: () => Promise<void>;
  activeMarkerLabel?: string | undefined;
  captureState: CaptureState;
  lastDrainSummary?: CaptureDrainSummary | undefined;
  onError: (message: string) => void;
  onActionStart: () => void;
}

export function RecorderBar(props: RecorderBarProps) {
  const [showMarker, setShowMarker] = useState(false);
  const action = useAsyncAction(props.onError, props.onActionStart);
  const isRecording = props.captureState === "recording";
  const isStopping = props.captureState === "stopping";
  const needsFinalization = props.captureState === "finalization-error";
  return (
    <div className={isRecording ? "recorder recording" : "recorder"}>
      <div className="recording-state">
        <span className="status-dot" />
        <div>
          <strong>
            {isStopping
              ? "Stopping and draining"
              : isRecording
                ? "Recording"
                : needsFinalization
                  ? "Finalization recovery required"
                  : "Recorder idle"}
          </strong>
          <small>{props.workflow?.name ?? "Select a workflow"}</small>
        </div>
      </div>
      <div className="recorder-metrics">
        <span>{props.workflow?.observationIds.length ?? 0} requests</span>
        <span>{props.ignoredCount} ignored</span>
        <span>{formatBytes(props.storageBytes)} local</span>
      </div>
      <div className="recorder-actions">
        {!isRecording && !isStopping ? (
          <button
            className="primary"
            type="button"
            disabled={!props.canRecord || action.submitting || isStopping || needsFinalization}
            onClick={() => action.run(props.onStart)}
          >
            Start recording
          </button>
        ) : (
          <button
            className="danger"
            type="button"
            disabled={action.submitting || isStopping}
            onClick={() => action.run(props.onStop)}
          >
            {isStopping ? "Draining…" : "Stop recording"}
          </button>
        )}
        <button
          type="button"
          disabled={!isRecording || action.submitting}
          onClick={() => setShowMarker((current) => !current)}
        >
          Add action marker
        </button>
      </div>
      {props.activeMarkerLabel && isRecording && (
        <div className="active-marker">
          <span>Active marker: {props.activeMarkerLabel}</span>
          <button
            type="button"
            disabled={action.submitting}
            onClick={() => action.run(props.onEndMarker)}
          >
            End marker
          </button>
        </div>
      )}
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
            const form = event.currentTarget;
            if (label)
              action.run(
                () => props.onMarker(label, notes || undefined),
                () => {
                  form.reset();
                  setShowMarker(false);
                },
              );
          }}
        >
          <input required autoFocus name="label" placeholder="Clicked Apply coupon" />
          <input name="notes" placeholder="Optional note" />
          <button type="submit">Mark now</button>
        </form>
      )}
      {props.lastDrainSummary &&
        (props.captureState === "idle" || props.captureState === "finalization-error") && (
          <small className="drain-summary">
            Last stop: {props.lastDrainSummary.completed} completed,{" "}
            {props.lastDrainSummary.timedOut} timed out, {props.lastDrainSummary.discarded}{" "}
            discarded, {props.lastDrainSummary.failed} failed.
          </small>
        )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
