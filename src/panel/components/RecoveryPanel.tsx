import type {
  CaptureDrainSummary,
  ExportReceipt,
  InterruptedWorkflowCandidate,
} from "../../shared/types";
import { useAsyncAction } from "../hooks/use-async-action";

interface FinalizationRecoveryPanelProps {
  error: string;
  summary: CaptureDrainSummary;
  onRetry: () => Promise<void>;
  onExport: () => Promise<ExportReceipt>;
  onError: (message: string) => void;
}

export function FinalizationRecoveryPanel(props: FinalizationRecoveryPanelProps) {
  const action = useAsyncAction(props.onError);
  return (
    <section className="recovery-panel" role="alert">
      <h2>Recording finalization failed</h2>
      <p>
        Captured requests were drained, but StateLens could not mark the workflow as completed in
        local storage. Network capture is stopped and a new recording is blocked.
      </p>
      <p className="recovery-error">{props.error}</p>
      <p>
        Drain result: {props.summary.completed} completed, {props.summary.timedOut} timed out,{" "}
        {props.summary.discarded} discarded, {props.summary.failed} failed.
      </p>
      <div className="recovery-actions">
        <button
          className="primary"
          disabled={action.submitting}
          onClick={() => action.run(props.onRetry)}
        >
          Retry finalization
        </button>
        <button
          disabled={action.submitting}
          onClick={() =>
            action.run(async () => {
              await props.onExport();
            })
          }
        >
          Export evidence
        </button>
      </div>
    </section>
  );
}

interface InterruptedWorkflowPanelProps {
  candidate: InterruptedWorkflowCandidate;
  onFinalize: () => Promise<void>;
  onKeep: () => void;
  onDiscard: () => Promise<void>;
  onError: (message: string) => void;
}

export function InterruptedWorkflowPanel(props: InterruptedWorkflowPanelProps) {
  const action = useAsyncAction(props.onError);
  const { workflow, observationCount, openMarkerCount } = props.candidate;
  return (
    <section className="recovery-panel interrupted" role="alert">
      <h2>Interrupted workflow detected</h2>
      <p>
        <strong>{workflow.name}</strong> was stored as recording, but no collector session is
        active. StateLens will not resume it automatically.
      </p>
      <p>
        {observationCount} observation(s), {openMarkerCount} open marker(s).
      </p>
      <div className="recovery-actions">
        <button
          className="primary"
          disabled={action.submitting}
          onClick={() => action.run(props.onFinalize)}
        >
          Finalize as interrupted
        </button>
        <button type="button" disabled={action.submitting} onClick={props.onKeep}>
          Keep for review
        </button>
        <button
          type="button"
          className="danger"
          disabled={action.submitting || observationCount !== 0}
          title={observationCount === 0 ? undefined : "Only an empty workflow can be discarded"}
          onClick={() => action.run(props.onDiscard)}
        >
          Discard empty workflow
        </button>
      </div>
    </section>
  );
}

interface InterruptedWorkflowsSectionProps {
  candidates: InterruptedWorkflowCandidate[];
  activeRecoveryWorkflowId?: string | undefined;
  keptWorkflowIds: string[];
  disabled: boolean;
  onReview: (workflowId: string) => void;
}

export function InterruptedWorkflowsSection(props: InterruptedWorkflowsSectionProps) {
  const kept = new Set(props.keptWorkflowIds);
  return (
    <section className="interrupted-workflows" aria-labelledby="interrupted-workflows-heading">
      <div>
        <h2 id="interrupted-workflows-heading">Interrupted workflows</h2>
        <p>Stored recordings remain available here until finalized or explicitly discarded.</p>
      </div>
      <ul>
        {props.candidates.map((candidate) => {
          const workflowId = candidate.workflow.id;
          const recoveryOpen = workflowId === props.activeRecoveryWorkflowId;
          return (
            <li key={workflowId}>
              <span>
                <strong>{candidate.workflow.name}</strong>
                <small>
                  {candidate.observationCount} observation(s), {candidate.openMarkerCount} open
                  marker(s) · {kept.has(workflowId) ? "Kept for review" : "Needs recovery"}
                </small>
              </span>
              <button
                type="button"
                disabled={props.disabled || recoveryOpen}
                onClick={() => props.onReview(workflowId)}
              >
                {recoveryOpen ? "Recovery open" : "Review recovery"}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
