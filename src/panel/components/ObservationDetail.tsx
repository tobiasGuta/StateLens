import { useState } from "react";
import type { RequestObservation } from "../../shared/schemas";

type Tab = "overview" | "request" | "response" | "parsed";

export function ObservationDetail({
  observation,
  onClose,
}: {
  observation: RequestObservation;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <aside className="detail-pane" aria-label="Observation details">
      <header>
        <div>
          <span className={`method method-${observation.method.toLowerCase()}`}>
            {observation.method}
          </span>
          <h2>{observation.path}</h2>
        </div>
        <button aria-label="Close details" type="button" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="tabs" role="tablist">
        {(["overview", "request", "response", "parsed"] as const).map((name) => (
          <button
            role="tab"
            aria-selected={tab === name}
            className={tab === name ? "active" : ""}
            onClick={() => setTab(name)}
            key={name}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="detail-content">
        {tab === "overview" && (
          <dl>
            <dt>Session sequence</dt>
            <dd>{observation.sessionSequence}</dd>
            <dt>URL</dt>
            <dd className="break">{observation.url}</dd>
            <dt>Status</dt>
            <dd>
              {observation.responseStatus} {observation.responseStatusText}
            </dd>
            <dt>Duration</dt>
            <dd>{observation.durationMs.toFixed(1)} ms</dd>
            <dt>MIME type</dt>
            <dd>{observation.responseMimeType || "Unknown"}</dd>
            <dt>Scope</dt>
            <dd>{observation.scopeValidation.reason}</dd>
            <dt>Redaction</dt>
            <dd>{observation.redactionStatus}</dd>
            <dt>Body limits</dt>
            <dd>{observation.truncationStatus}</dd>
          </dl>
        )}
        {tab === "request" && (
          <>
            <h3>Headers</h3>
            <HeaderTable headers={observation.requestHeaders} />
            <h3>Body metadata</h3>
            <Json value={observation.requestBodyMetadata} />
          </>
        )}
        {tab === "response" && (
          <>
            <h3>Headers</h3>
            <HeaderTable headers={observation.responseHeaders} />
            <h3>Body metadata</h3>
            <Json value={observation.responseBodyMetadata} />
            {observation.captureErrors.length > 0 && (
              <>
                <h3>Capture limitations</h3>
                <Json value={observation.captureErrors} />
              </>
            )}
          </>
        )}
        {tab === "parsed" && (
          <>
            <h3>Request data</h3>
            <Json value={observation.parsedRequestBody ?? "Not stored or unavailable"} />
            <h3>Response data</h3>
            <Json value={observation.parsedResponseBody ?? "Not stored or unavailable"} />
          </>
        )}
      </div>
    </aside>
  );
}

function HeaderTable({ headers }: { headers: RequestObservation["requestHeaders"] }) {
  return (
    <div className="header-table">
      {headers.length === 0 ? (
        <p className="empty">No headers captured.</p>
      ) : (
        headers.map((header, index) => (
          <div key={`${header.name}-${index}`}>
            <strong>{header.name}</strong>
            <code>{header.value}</code>
            {header.redacted && <span className="pill">redacted</span>}
          </div>
        ))
      )}
    </div>
  );
}

function Json({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
