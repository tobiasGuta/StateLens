import { useCallback, useEffect, useRef, useState } from "react";
import { createActionMarker } from "../capture/action-markers";
import { NetworkCollector } from "../capture/network-collector";
import { createSanitizedJsonExport, downloadTextFile } from "../export/json-exporter";
import { clampProjectLimits } from "../security/size-limits";
import { createProjectSalt } from "../security/token-fingerprint";
import { StateLensRepository } from "../storage/database";
import {
  defaultProjectLimits,
  type AccountContext,
  type ActionMarker,
  type Project,
  type ProjectLimits,
  type RequestObservation,
  type ScopeRule,
  type Workflow,
} from "../shared/schemas";
import type { CaptureContext, IgnoredRequestSummary, ProjectBundle } from "../shared/types";
import { Dashboard } from "./components/Dashboard";
import { LimitSettings } from "./components/LimitSettings";
import { ObservationDetail } from "./components/ObservationDetail";
import { ProjectSetup } from "./components/ProjectSetup";
import { RecorderBar } from "./components/RecorderBar";
import { Sidebar, type PageName } from "./components/Sidebar";
import { Timeline } from "./components/Timeline";

export default function App() {
  const [repository, setRepository] = useState<StateLensRepository>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<AccountContext[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [markers, setMarkers] = useState<ActionMarker[]>([]);
  const [observations, setObservations] = useState<RequestObservation[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string>();
  const [activeAccountId, setActiveAccountId] = useState<string>();
  const [activeWorkflowId, setActiveWorkflowId] = useState<string>();
  const [activeMarker, setActiveMarker] = useState<ActionMarker>();
  const [selectedObservation, setSelectedObservation] = useState<RequestObservation>();
  const [page, setPage] = useState<PageName>("dashboard");
  const [ignored, setIgnored] = useState<IgnoredRequestSummary>({ count: 0, hostnames: [] });
  const [storageBytes, setStorageBytes] = useState(0);
  const [recoverableErrors, setRecoverableErrors] = useState(0);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const collectorRef = useRef(new NetworkCollector());
  const captureContextRef = useRef<CaptureContext | undefined>(undefined);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const activeWorkflow = workflows.find((workflow) => workflow.id === activeWorkflowId);

  useEffect(() => {
    if (activeProject && activeAccount && activeWorkflow) {
      captureContextRef.current = {
        project: activeProject,
        workflow: activeWorkflow,
        accountContext: activeAccount,
        ...(activeMarker ? { activeMarker } : {}),
      };
    } else {
      captureContextRef.current = undefined;
    }
  }, [activeAccount, activeMarker, activeProject, activeWorkflow]);

  useEffect(() => {
    let alive = true;
    const collector = collectorRef.current;
    void StateLensRepository.open()
      .then(async (opened) => {
        if (!alive) return opened.close();
        setRepository(opened);
        const loadedProjects = await opened.listProjects();
        setProjects(loadedProjects);
        setRecoverableErrors((await opened.listRecoverableErrors()).length);
        if (loadedProjects[0]) setActiveProjectId(loadedProjects[0].id);
      })
      .catch((cause: unknown) => {
        setError(`Local database could not be opened: ${errorMessage(cause)}`);
      });
    return () => {
      alive = false;
      collector.stop();
    };
  }, []);

  useEffect(() => {
    if (!repository || !activeProjectId) {
      setAccounts([]);
      setWorkflows([]);
      setObservations([]);
      setMarkers([]);
      return;
    }
    let alive = true;
    void Promise.all([
      repository.listAccountContexts(activeProjectId),
      repository.listWorkflows(activeProjectId),
      repository.estimateProjectBytes(activeProjectId),
    ])
      .then(([loadedAccounts, loadedWorkflows, estimatedBytes]) => {
        if (!alive) return;
        setAccounts(loadedAccounts);
        setWorkflows(loadedWorkflows);
        setStorageBytes(estimatedBytes);
        setActiveAccountId((current) =>
          loadedAccounts.some((item) => item.id === current) ? current : loadedAccounts[0]?.id,
        );
        setActiveWorkflowId((current) =>
          loadedWorkflows.some((item) => item.id === current) ? current : loadedWorkflows[0]?.id,
        );
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
    return () => {
      alive = false;
    };
  }, [activeProjectId, repository]);

  useEffect(() => {
    if (!repository || !activeWorkflowId) {
      setObservations([]);
      setMarkers([]);
      return;
    }
    let alive = true;
    void Promise.all([
      repository.listObservations(activeWorkflowId),
      repository.listActionMarkers(activeWorkflowId),
    ])
      .then(([loadedObservations, loadedMarkers]) => {
        if (!alive) return;
        setObservations(loadedObservations.sort((a, b) => a.timestamp.localeCompare(b.timestamp)));
        setMarkers(loadedMarkers.sort((a, b) => a.startedAt.localeCompare(b.startedAt)));
      })
      .catch((cause: unknown) => setError(errorMessage(cause)));
    return () => {
      alive = false;
    };
  }, [activeWorkflowId, repository]);

  const refreshStorage = useCallback(async () => {
    if (repository && activeProjectId)
      setStorageBytes(await repository.estimateProjectBytes(activeProjectId));
  }, [activeProjectId, repository]);

  async function createProject(name: string, description?: string): Promise<void> {
    if (!repository) return;
    if (activeWorkflow?.status === "recording") {
      setError("Stop the active recording before changing projects.");
      return;
    }
    const now = new Date().toISOString();
    const project: Project = {
      id: crypto.randomUUID(),
      name,
      ...(description ? { description } : {}),
      createdAt: now,
      updatedAt: now,
      scope: [],
      settings: {
        limits: defaultProjectLimits(),
        projectSalt: createProjectSalt(),
        customRedactionPatterns: [],
        revealIgnoredHostnames: false,
      },
    };
    await repository.putProject(project);
    setProjects((current) => [...current, project]);
    setActiveProjectId(project.id);
    setPage("settings");
    setMessage("Project created. Add at least one explicit scope rule before recording.");
  }

  async function addScope(rule: Omit<ScopeRule, "id" | "enabled">): Promise<void> {
    if (!repository || !activeProject) return;
    validateScopeInput(rule);
    const updated: Project = {
      ...activeProject,
      scope: [...activeProject.scope, { ...rule, id: crypto.randomUUID(), enabled: true }],
      updatedAt: new Date().toISOString(),
    };
    await repository.putProject(updated);
    setProjects((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setMessage("Scope rule added explicitly.");
  }

  async function createAccount(name: string, role?: string, tenantLabel?: string): Promise<void> {
    if (!repository || !activeProject) return;
    if (activeWorkflow?.status === "recording") {
      setError("Stop the active recording before changing account contexts.");
      return;
    }
    const account: AccountContext = {
      id: crypto.randomUUID(),
      projectId: activeProject.id,
      name,
      ...(role ? { role } : {}),
      ...(tenantLabel ? { tenantLabel } : {}),
    };
    await repository.putAccountContext(account);
    setAccounts((current) => [...current, account]);
    setActiveAccountId(account.id);
  }

  async function createWorkflow(name: string): Promise<void> {
    if (!repository || !activeProject || !activeAccountId) return;
    if (activeWorkflow?.status === "recording") {
      setError("Stop the active recording before creating another workflow.");
      return;
    }
    const workflow: Workflow = {
      id: crypto.randomUUID(),
      projectId: activeProject.id,
      accountContextId: activeAccountId,
      name,
      status: "draft",
      observationIds: [],
      markerIds: [],
    };
    await repository.putWorkflow(workflow);
    setWorkflows((current) => [...current, workflow]);
    setActiveWorkflowId(workflow.id);
  }

  async function startRecording(): Promise<void> {
    if (!repository || !activeProject || !activeAccount || !activeWorkflow) return;
    if (!activeProject.scope.some((rule) => rule.enabled)) {
      setError("Recording is blocked until an enabled scope rule exists.");
      return;
    }
    if (activeWorkflow.accountContextId !== activeAccount.id) {
      setError("The selected workflow belongs to a different account context.");
      return;
    }
    const updated: Workflow = {
      ...activeWorkflow,
      status: "recording",
      startedAt: activeWorkflow.startedAt ?? new Date().toISOString(),
      endedAt: undefined,
    };
    await repository.putWorkflow(updated);
    setWorkflows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    captureContextRef.current = {
      project: activeProject,
      workflow: updated,
      accountContext: activeAccount,
    };
    setIgnored({ count: 0, hostnames: [] });
    setError(undefined);
    setMessage("Recording started. Reload the inspected page to capture its full workflow.");
    collectorRef.current.start({
      getContext: () => captureContextRef.current,
      onObservation: async (observation) => {
        const storedWorkflow = await repository.appendObservation(observation);
        setObservations((current) => [...current, observation]);
        setWorkflows((current) =>
          current.map((item) => (item.id === storedWorkflow.id ? storedWorkflow : item)),
        );
        if (captureContextRef.current)
          captureContextRef.current = { ...captureContextRef.current, workflow: storedWorkflow };
        await refreshStorage();
      },
      onIgnored: setIgnored,
      onError: setError,
      onLimitReached: stopRecording,
    });
  }

  async function stopRecording(): Promise<void> {
    const workflowToStop = captureContextRef.current?.workflow ?? activeWorkflow;
    if (!repository || !workflowToStop) return;
    collectorRef.current.stop();
    const updated: Workflow = {
      ...workflowToStop,
      status: "completed",
      endedAt: new Date().toISOString(),
    };
    await repository.putWorkflow(updated);
    setWorkflows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setActiveMarker(undefined);
    setMessage(`Recording stopped with ${updated.observationIds.length} captured request(s).`);
  }

  async function addMarker(label: string, notes?: string): Promise<void> {
    if (!repository || !activeWorkflow) return;
    const marker = createActionMarker(activeWorkflow.id, label, notes);
    const updated = { ...activeWorkflow, markerIds: [...activeWorkflow.markerIds, marker.id] };
    await repository.putActionMarker(marker);
    await repository.putWorkflow(updated);
    setMarkers((current) => [...current, marker]);
    setWorkflows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setActiveMarker(marker);
  }

  async function exportProject(): Promise<ProjectBundle | undefined> {
    if (!repository || !activeProject) return;
    const projectWorkflows = await repository.listWorkflows(activeProject.id);
    const bundle: ProjectBundle = {
      exportedAt: new Date().toISOString(),
      formatVersion: 1,
      project: activeProject,
      accountContexts: await repository.listAccountContexts(activeProject.id),
      workflows: projectWorkflows,
      actionMarkers: (
        await Promise.all(
          projectWorkflows.map((workflow) => repository.listActionMarkers(workflow.id)),
        )
      ).flat(),
      observations: await repository.listProjectObservations(activeProject.id),
    };
    downloadTextFile(`${activeProject.name}-statelens.json`, createSanitizedJsonExport(bundle));
    setMessage("Sanitized project evidence exported. Raw secrets were excluded.");
    return bundle;
  }

  async function exportThenPurge(): Promise<void> {
    if (!repository || !activeProject) return;
    if (!window.confirm(`Export and permanently delete local project “${activeProject.name}”?`))
      return;
    await exportProject();
    await repository.purgeProject(activeProject.id);
    const remaining = projects.filter((item) => item.id !== activeProject.id);
    setProjects(remaining);
    setActiveProjectId(remaining[0]?.id);
    setMessage("Project export completed and local project data was purged.");
  }

  async function saveProjectSettings(
    limits: ProjectLimits,
    revealIgnoredHostnames: boolean,
  ): Promise<void> {
    if (!repository || !activeProject) return;
    const updated: Project = {
      ...activeProject,
      updatedAt: new Date().toISOString(),
      settings: {
        ...activeProject.settings,
        limits: clampProjectLimits(limits),
        revealIgnoredHostnames,
      },
    };
    await repository.putProject(updated);
    setProjects((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setMessage("Bounded capture settings saved for this project.");
  }

  function selectWhileIdle(kind: "project" | "account" | "workflow", id: string): void {
    if (activeWorkflow?.status === "recording") {
      setError(`Stop the active recording before changing the ${kind}.`);
      return;
    }
    if (kind === "project") setActiveProjectId(id);
    else if (kind === "account") setActiveAccountId(id);
    else setActiveWorkflowId(id);
  }

  const canRecord = Boolean(
    activeProject?.scope.some((rule) => rule.enabled) &&
    activeAccount &&
    activeWorkflow &&
    activeWorkflow.status !== "recording" &&
    activeWorkflow.accountContextId === activeAccount.id,
  );

  return (
    <div className="app-shell">
      <Sidebar page={page} onChange={setPage} />
      <main>
        <header className="topbar">
          <div>
            <h1>{pageTitle(page)}</h1>
            <p>{pageSubtitle(page)}</p>
          </div>
          <div className="scope-badge">
            <span>Active scope</span>
            <strong>
              {activeProject?.scope.filter((rule) => rule.enabled).length ?? 0} rule(s)
            </strong>
          </div>
        </header>
        {message && (
          <div className="notice" role="status">
            {message}
            <button aria-label="Dismiss message" onClick={() => setMessage(undefined)}>
              ×
            </button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError(undefined)}>
              ×
            </button>
          </div>
        )}
        <RecorderBar
          workflow={activeWorkflow}
          canRecord={canRecord}
          ignoredCount={ignored.count}
          storageBytes={storageBytes}
          onStart={startRecording}
          onStop={stopRecording}
          onMarker={addMarker}
        />
        <div className={selectedObservation ? "workspace with-detail" : "workspace"}>
          <div className="page-content">
            {page === "dashboard" && (
              <Dashboard
                project={activeProject}
                account={activeAccount}
                workflow={activeWorkflow}
                observations={observations}
                storageBytes={storageBytes}
                recoverableErrors={recoverableErrors}
              />
            )}
            {page === "timeline" && (
              <Timeline
                observations={observations}
                markers={markers}
                selectedId={selectedObservation?.id}
                onSelect={setSelectedObservation}
              />
            )}
            {(page === "workflows" || page === "settings") && (
              <ProjectSetup
                projects={projects}
                accounts={accounts}
                workflows={workflows}
                activeProjectId={activeProjectId}
                activeAccountId={activeAccountId}
                activeWorkflowId={activeWorkflowId}
                onSelectProject={(id) => selectWhileIdle("project", id)}
                onSelectAccount={(id) => selectWhileIdle("account", id)}
                onSelectWorkflow={(id) => selectWhileIdle("workflow", id)}
                onCreateProject={createProject}
                onAddScope={addScope}
                onCreateAccount={createAccount}
                onCreateWorkflow={createWorkflow}
              />
            )}
            {page === "evidence" && (
              <section className="card evidence-card">
                <h2>Sanitized evidence export</h2>
                <p>
                  Export the current project, contexts, workflows, markers, and observations as
                  validated JSON. Authorization, cookies, token fields, session values, and matching
                  custom patterns remain redacted.
                </p>
                <button
                  className="primary"
                  disabled={!activeProject}
                  onClick={() => void exportProject()}
                >
                  Export sanitized JSON
                </button>
                <hr />
                <h2>Local data purge</h2>
                <p>
                  StateLens exports a sanitized copy before deleting the selected project and its
                  related local records.
                </p>
                <button
                  className="danger"
                  disabled={!activeProject || activeWorkflow?.status === "recording"}
                  onClick={() => void exportThenPurge()}
                >
                  Export then purge project
                </button>
              </section>
            )}
            {page === "settings" && activeProject && (
              <>
                <LimitSettings
                  limits={activeProject.settings.limits}
                  revealIgnoredHostnames={activeProject.settings.revealIgnoredHostnames}
                  disabled={activeWorkflow?.status === "recording"}
                  onSave={saveProjectSettings}
                />
                <section className="card permission-card">
                  <h2>Permission status</h2>
                  <p>
                    <strong>Required Chrome permissions:</strong> none. DevTools supplies completed
                    request metadata only while DevTools is open.
                  </p>
                  <p>
                    <strong>Optional host permissions:</strong> none requested. StateLens does not
                    inject content scripts or access sites in the background.
                  </p>
                  <p>
                    Close DevTools or stop recording to end capture. Extension access can be revoked
                    from <code>chrome://extensions</code>.
                  </p>
                  {ignored.hostnames.length > 0 && (
                    <>
                      <h3>Ignored out-of-scope hosts</h3>
                      <ul>
                        {ignored.hostnames.map((host) => (
                          <li key={host}>{host}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              </>
            )}
          </div>
          {selectedObservation && (
            <ObservationDetail
              observation={selectedObservation}
              onClose={() => setSelectedObservation(undefined)}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "Unexpected error";
}
function validateScopeInput(rule: Omit<ScopeRule, "id" | "enabled">): void {
  if (rule.type === "url-prefix") {
    const url = new URL(rule.value);
    if (!/^https?:$/.test(url.protocol)) throw new Error("URL-prefix scope must use HTTP or HTTPS");
    return;
  }
  const url = new URL(rule.value.includes("://") ? rule.value : `https://${rule.value}`);
  if (!url.hostname || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Host scope must contain only a hostname, with optional scheme and port");
}
function pageTitle(page: PageName): string {
  return {
    dashboard: "Dashboard",
    timeline: "Evidence timeline",
    workflows: "Workflow setup",
    evidence: "Evidence",
    settings: "Project settings",
  }[page];
}
function pageSubtitle(page: PageName): string {
  return {
    dashboard: "Current capture and privacy posture",
    timeline: "Chronological, evidence-backed observations",
    workflows: "Projects, authorized contexts, and recordings",
    evidence: "Safe local export and purge controls",
    settings: "Explicit scope and minimal permissions",
  }[page];
}
