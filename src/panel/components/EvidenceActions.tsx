import { useState } from "react";
import type { ExportReceipt, ProjectRecordCounts } from "../../shared/types";
import { useAsyncAction } from "../hooks/use-async-action";

interface EvidenceActionsProps {
  projectName: string;
  counts: ProjectRecordCounts;
  captureState: "idle" | "recording" | "stopping";
  onExport: () => Promise<ExportReceipt>;
  onPurge: (confirmationName: string) => Promise<void>;
  onError: (message: string) => void;
  onActionStart: () => void;
}

export function EvidenceActions(props: EvidenceActionsProps) {
  const [receipt, setReceipt] = useState<ExportReceipt>();
  const [showPurge, setShowPurge] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const action = useAsyncAction(props.onError, props.onActionStart);
  const locked = props.captureState !== "idle" || action.submitting;

  return (
    <section className="card evidence-card">
      <h2>Sanitized evidence export</h2>
      <p>
        Initiate a sanitized JSON download. StateLens reports the exact bytes and SHA-256 digest,
        but cannot confirm that the browser saved the file.
      </p>
      <button
        className="primary"
        disabled={locked}
        onClick={() =>
          action.run(async () => {
            setReceipt(await props.onExport());
          })
        }
      >
        Initiate sanitized JSON download
      </button>
      {receipt && (
        <dl className="export-receipt" aria-label="Export initiation details">
          <dt>Expected filename</dt>
          <dd>{receipt.filename}</dd>
          <dt>Exact byte size</dt>
          <dd>{receipt.byteSize.toLocaleString()}</dd>
          <dt>SHA-256</dt>
          <dd>
            <code>{receipt.sha256}</code>
          </dd>
          <dt>Status</dt>
          <dd>Download initiated; save completion is not known.</dd>
        </dl>
      )}
      <hr />
      <h2>Purge local project</h2>
      <p>Purge is separate from export and cannot be undone. No backup is assumed.</p>
      <dl className="purge-counts">
        <dt>Project</dt>
        <dd>{props.projectName}</dd>
        <dt>Account contexts</dt>
        <dd>{props.counts.accountContexts}</dd>
        <dt>Workflows</dt>
        <dd>{props.counts.workflows}</dd>
        <dt>Action markers</dt>
        <dd>{props.counts.actionMarkers}</dd>
        <dt>Observations</dt>
        <dd>{props.counts.observations}</dd>
      </dl>
      {!showPurge ? (
        <button className="danger" disabled={locked} onClick={() => setShowPurge(true)}>
          Begin purge confirmation
        </button>
      ) : (
        <div className="purge-confirmation">
          <label>
            Type <strong>{props.projectName}</strong> to confirm
            <input
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              disabled={locked}
            />
          </label>
          <p className="danger-copy">This permanently deletes the listed local records.</p>
          <div>
            <button
              type="button"
              disabled={action.submitting}
              onClick={() => {
                setShowPurge(false);
                setConfirmationName("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger"
              disabled={locked || confirmationName !== props.projectName}
              onClick={() => action.run(() => props.onPurge(confirmationName))}
            >
              Permanently purge project
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
