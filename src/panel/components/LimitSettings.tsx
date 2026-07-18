import { useState, type FormEvent } from "react";
import { SAFE_LIMIT_CEILINGS } from "../../shared/constants";
import type { ProjectLimits } from "../../shared/schemas";
import { useAsyncAction } from "../hooks/use-async-action";

interface LimitSettingsProps {
  limits: ProjectLimits;
  revealIgnoredHostnames: boolean;
  disabled: boolean;
  onSave: (limits: ProjectLimits, revealIgnoredHostnames: boolean) => Promise<void>;
  onError: (message: string) => void;
  onActionStart: () => void;
}

const fields: { key: keyof ProjectLimits; label: string; ceiling: number }[] = [
  {
    key: "maxRequestBodyBytes",
    label: "Maximum request body bytes",
    ceiling: SAFE_LIMIT_CEILINGS.maxRequestBodyBytes,
  },
  {
    key: "maxResponseBodyBytes",
    label: "Maximum response body bytes",
    ceiling: SAFE_LIMIT_CEILINGS.maxResponseBodyBytes,
  },
  { key: "maxJsonDepth", label: "Maximum JSON depth", ceiling: SAFE_LIMIT_CEILINGS.maxJsonDepth },
  {
    key: "maxObjectKeys",
    label: "Maximum parsed object keys",
    ceiling: SAFE_LIMIT_CEILINGS.maxObjectKeys,
  },
  {
    key: "maxObservationsPerWorkflow",
    label: "Maximum workflow observations",
    ceiling: SAFE_LIMIT_CEILINGS.maxObservationsPerWorkflow,
  },
  {
    key: "projectStorageWarningBytes",
    label: "Project storage warning bytes",
    ceiling: SAFE_LIMIT_CEILINGS.projectStorageWarningBytes,
  },
];

export function LimitSettings(props: LimitSettingsProps) {
  const [showHosts, setShowHosts] = useState(props.revealIgnoredHostnames);
  const action = useAsyncAction(props.onError, props.onActionStart);
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next = Object.fromEntries(
      fields.map(({ key }) => [key, Number(data.get(key))]),
    ) as unknown as ProjectLimits;
    action.run(() => props.onSave(next, showHosts));
  }
  return (
    <section className="card limit-card">
      <h2>Capture limits</h2>
      <p>Limits are stored per project and cannot exceed the hard safety ceilings shown below.</p>
      <form onSubmit={submit} aria-busy={action.submitting}>
        <div className="limit-grid">
          {fields.map(({ key, label, ceiling }) => (
            <label key={key}>
              {label}
              <input
                name={key}
                type="number"
                required
                min={1}
                max={ceiling}
                defaultValue={props.limits[key]}
                disabled={props.disabled || action.submitting}
              />
              <small>Maximum {ceiling.toLocaleString()}</small>
            </label>
          ))}
        </div>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={showHosts}
            disabled={props.disabled || action.submitting}
            onChange={(event) => setShowHosts(event.target.checked)}
          />
          Show normalized hostnames for ignored out-of-scope requests
        </label>
        <button type="submit" disabled={props.disabled || action.submitting}>
          Save bounded settings
        </button>
      </form>
    </section>
  );
}
