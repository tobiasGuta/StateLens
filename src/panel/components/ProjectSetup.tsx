import { useState, type FormEvent } from "react";
import type { AccountContext, Project, ScopeRule, Workflow } from "../../shared/schemas";

interface ProjectSetupProps {
  projects: Project[];
  activeProjectId?: string | undefined;
  accounts: AccountContext[];
  workflows: Workflow[];
  activeAccountId?: string | undefined;
  activeWorkflowId?: string | undefined;
  onSelectProject: (id: string) => void;
  onSelectAccount: (id: string) => void;
  onSelectWorkflow: (id: string) => void;
  onCreateProject: (name: string, description?: string) => Promise<void>;
  onAddScope: (rule: Omit<ScopeRule, "id" | "enabled">) => Promise<void>;
  onCreateAccount: (name: string, role?: string, tenantLabel?: string) => Promise<void>;
  onCreateWorkflow: (name: string) => Promise<void>;
}

function submitValue(event: FormEvent<HTMLFormElement>, name: string): string {
  const value = new FormData(event.currentTarget).get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function ProjectSetup(props: ProjectSetupProps) {
  const [scopeType, setScopeType] = useState<ScopeRule["type"]>("exact-host");
  const activeProject = props.projects.find((project) => project.id === props.activeProjectId);
  return (
    <div className="setup-grid">
      <section className="card">
        <div className="section-heading">
          <h2>Project</h2>
          <span className="step">1</span>
        </div>
        {props.projects.length > 0 && (
          <label>
            Active project
            <select
              value={props.activeProjectId ?? ""}
              onChange={(event) => props.onSelectProject(event.target.value)}
            >
              {props.projects.map((project) => (
                <option value={project.id} key={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = submitValue(event, "name");
            const description = submitValue(event, "description");
            if (name) void props.onCreateProject(name, description || undefined);
            event.currentTarget.reset();
          }}
        >
          <label>
            New project name
            <input required name="name" maxLength={120} placeholder="Authorized target" />
          </label>
          <label>
            Description
            <input name="description" maxLength={2000} placeholder="Optional engagement note" />
          </label>
          <button className="primary" type="submit">
            Create project
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>Allowed scope</h2>
          <span className="step">2</span>
        </div>
        {!activeProject ? (
          <p className="empty">Create a project first.</p>
        ) : (
          <>
            {activeProject.scope.length === 0 ? (
              <div className="warning">Recording is blocked until a scope rule is added.</div>
            ) : (
              <ul className="scope-list">
                {activeProject.scope.map((rule) => (
                  <li key={rule.id}>
                    <span>{rule.type}</span>
                    <code>{rule.value}</code>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = submitValue(event, "value");
                if (value) void props.onAddScope({ type: scopeType, value });
                event.currentTarget.reset();
              }}
            >
              <label>
                Rule type
                <select
                  value={scopeType}
                  onChange={(event) => setScopeType(event.target.value as ScopeRule["type"])}
                >
                  <option value="exact-host">Exact host</option>
                  <option value="subdomain">Host and subdomains</option>
                  <option value="url-prefix">URL prefix</option>
                </select>
              </label>
              <label>
                Scope value
                <input
                  required
                  name="value"
                  placeholder={
                    scopeType === "url-prefix" ? "https://example.test/api/" : "example.test"
                  }
                />
              </label>
              <button type="submit">Add explicit rule</button>
            </form>
          </>
        )}
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>Account context</h2>
          <span className="step">3</span>
        </div>
        {props.accounts.length > 0 && (
          <label>
            Current context
            <select
              value={props.activeAccountId ?? ""}
              onChange={(event) => props.onSelectAccount(event.target.value)}
            >
              {props.accounts.map((account) => (
                <option value={account.id} key={account.id}>
                  {account.name}
                  {account.role ? ` · ${account.role}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = submitValue(event, "name");
            const role = submitValue(event, "role");
            const tenant = submitValue(event, "tenant");
            if (name) void props.onCreateAccount(name, role || undefined, tenant || undefined);
            event.currentTarget.reset();
          }}
        >
          <label>
            Name
            <input required name="name" placeholder="Account A" />
          </label>
          <div className="form-row">
            <label>
              Role
              <input name="role" placeholder="Member" />
            </label>
            <label>
              Tenant label
              <input name="tenant" placeholder="Organization A" />
            </label>
          </div>
          <button type="submit" disabled={!activeProject}>
            Add context
          </button>
        </form>
      </section>

      <section className="card">
        <div className="section-heading">
          <h2>Workflow</h2>
          <span className="step">4</span>
        </div>
        {props.workflows.length > 0 && (
          <label>
            Selected workflow
            <select
              value={props.activeWorkflowId ?? ""}
              onChange={(event) => props.onSelectWorkflow(event.target.value)}
            >
              {props.workflows.map((workflow) => (
                <option value={workflow.id} key={workflow.id}>
                  {workflow.name} · {workflow.status}
                </option>
              ))}
            </select>
          </label>
        )}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = submitValue(event, "name");
            if (name) void props.onCreateWorkflow(name);
            event.currentTarget.reset();
          }}
        >
          <label>
            Workflow name
            <input required name="name" placeholder="Create and pay invoice" />
          </label>
          <button type="submit" disabled={!props.activeAccountId}>
            Create workflow
          </button>
        </form>
      </section>
    </div>
  );
}
