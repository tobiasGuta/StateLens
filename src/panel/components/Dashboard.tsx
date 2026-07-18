import type { AccountContext, Project, RequestObservation, Workflow } from "../../shared/schemas";

interface DashboardProps {
  project?: Project | undefined;
  account?: AccountContext | undefined;
  workflow?: Workflow | undefined;
  observations: RequestObservation[];
  storageBytes: number;
  recoverableErrors: number;
}

export function Dashboard({
  project,
  account,
  workflow,
  observations,
  storageBytes,
  recoverableErrors,
}: DashboardProps) {
  const redacted = observations.filter((item) => item.redactionStatus === "redacted").length;
  const limited = observations.filter((item) => item.truncationStatus !== "none").length;
  return (
    <div className="dashboard">
      {!project?.scope.length && (
        <div className="warning prominent">
          <strong>No active scope</strong>
          <span>Recording is disabled. Add an explicit target rule in Project Settings.</span>
        </div>
      )}
      <div className="metric-grid">
        <Metric label="Observations" value={observations.length} />
        <Metric label="Redacted records" value={redacted} />
        <Metric label="Limited bodies" value={limited} />
        <Metric label="Local project size" value={formatBytes(storageBytes)} />
      </div>
      {project && storageBytes >= project.settings.limits.projectStorageWarningBytes && (
        <div className="warning prominent">
          <strong>Project storage warning</strong>
          <span>The configured local project warning threshold has been reached.</span>
        </div>
      )}
      <div className="dashboard-grid">
        <section className="card">
          <h2>Active context</h2>
          <dl>
            <dt>Project</dt>
            <dd>{project?.name ?? "Not selected"}</dd>
            <dt>Account</dt>
            <dd>{account?.name ?? "Not selected"}</dd>
            <dt>Role</dt>
            <dd>{account?.role ?? "Not specified"}</dd>
            <dt>Workflow</dt>
            <dd>{workflow?.name ?? "Not selected"}</dd>
            <dt>Status</dt>
            <dd>{workflow?.status ?? "—"}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Privacy boundary</h2>
          <ul className="check-list">
            <li>Traffic stays in this browser profile</li>
            <li>Secrets are redacted before persistence</li>
            <li>Out-of-scope bodies are never requested</li>
            <li>No replay, scanning, telemetry, or cloud analysis</li>
          </ul>
          {recoverableErrors > 0 && (
            <div className="warning">
              {recoverableErrors} invalid local record(s) were isolated and logged for recovery.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
function formatBytes(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
