export type PageName = "dashboard" | "timeline" | "workflows" | "evidence" | "settings";

const items: { id: PageName; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "timeline", label: "Timeline" },
  { id: "workflows", label: "Workflows" },
  { id: "evidence", label: "Evidence" },
  { id: "settings", label: "Project Settings" },
];

export function Sidebar({
  page,
  onChange,
}: {
  page: PageName;
  onChange: (page: PageName) => void;
}) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <img className="brand-mark" src="/icons/statelens-32.png" alt="" aria-hidden="true" />
        <div>
          <strong>StateLens</strong>
          <small>Workflow Mapper</small>
        </div>
      </div>
      <nav aria-label="Main navigation">
        {items.map((item) => (
          <button
            className={page === item.id ? "nav-item active" : "nav-item"}
            key={item.id}
            onClick={() => onChange(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-note">
        <span className="status-dot safe" /> Local only
        <small>No telemetry or remote analysis</small>
      </div>
    </aside>
  );
}
