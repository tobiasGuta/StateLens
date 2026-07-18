import { useCallback, useEffect, useRef, useState } from "react";
import { createActionMarker } from "../capture/action-markers";
import { NetworkCollector } from "../capture/network-collector";
import { initiateSanitizedJsonExport } from "../export/json-exporter";
import { clampProjectLimits } from "../security/size-limits";
import { normalizeScopeRuleValue } from "../security/scope-validator";
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
import type {
  CaptureContext,
  CaptureDrainSummary,
  ExportReceipt,
  IgnoredRequestSummary,
  ProjectBundle,
  ProjectRecordCounts,
} from "../shared/types";
import { Dashboard } from "./components/Dashboard";
import { EvidenceActions } from "./components/EvidenceActions";
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
  const [captureState, setCaptureState] = useState<"idle" | "recording" | "stopping">("idle");
  const [lastDrainSummary, setLastDrainSummary] = useState<CaptureDrainSummary>();
  const [recordCounts, setRecordCounts] = useState<ProjectRecordCounts>({
    projects: 0,
    accountContexts: 0,
    workflows: 0,
    actionMarkers: 0,
    observations: 0,
  });
  const collectorRef = useRef(new NetworkCollector());
  const captureContextRef = useRef<CaptureContext | undefined>(undefined);
  const recordingSessionIdRef = useRef<string | undefined>(undefined);
  const stopPromiseRef = useRef<Promise<void> | undefined>(undefined);

  const activeProject = projects.find((project) => project.id === activeProjectId);
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const activeWorkflow = workflows.find((workflow) => workflow.id === activeWorkflowId);

  useEffect(() => {
    if (captureState !== "idle") return;
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
  }, [activeAccount, activeMarker, activeProject, activeWorkflow, captureState]);

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
      void collector.stop().catch(() => undefined);
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
      repository.getProjectRecordCounts(activeProjectId),
    ])
      .then(([loadedAccounts, loadedWorkflows, estimatedBytes, loadedCounts]) => {
        if (!alive) return;
        setAccounts(loadedAccounts);
        setWorkflows(loadedWorkflows);
        setStorageBytes(estimatedBytes);
        setRecordCounts(loadedCounts);
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
    if (repository && activeProjectId) {
      const [bytes, counts] = await Promise.all([
        repository.estimateProjectBytes(activeProjectId),
        repository.getProjectRecordCounts(activeProjectId),
      ]);
      setStorageBytes(bytes);
      setRecordCounts(counts);
    }
  }, [activeProjectId, repository]);

  async function createProject(name: string, description?: string): Promise<void> {
    if (!repository) return;
    if (captureState !== "idle") {
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
    const normalizedRule = { ...rule, value: normalizeScopeRuleValue(rule.type, rule.value) };
    const updated: Project = {
      ...activeProject,
      scope: [
        ...activeProject.scope,
        { ...normalizedRule, id: crypto.randomUUID(), enabled: true },
      ],
      updatedAt: new Date().toISOString(),
    };
    await repository.putProject(updated);
    setProjects((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setMessage("Scope rule added explicitly.");
  }

  async function createAccount(name: string, role?: string, tenantLabel?: string): Promise<void> {
    if (!repository || !activeProject) return;
    if (captureState !== "idle") {
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
    if (captureState !== "idle") {
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
    if (captureState !== "idle" || collectorRef.current.getState() !== "idle") {
      throw new Error("A recording is already active or stopping");
    }
    if (!activeProject.scope.some((rule) => rule.enabled)) {
      setError("Recording is blocked until an enabled scope rule exists.");
      return;
    }
    if (activeWorkflow.accountContextId !== activeAccount.id) {
      setError("The selected workflow belongs to a different account context.");
      return;
    }
    if (activeWorkflow.status !== "draft") {
      throw new Error("Create a new draft workflow before starting another recording");
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
    setLastDrainSummary(undefined);
    setError(undefined);
    let sessionId: string;
    try {
      sessionId = collectorRef.current.start({
        getContext: () => captureContextRef.current,
        onObservation: async (observation, handlerSessionId) => {
          if (recordingSessionIdRef.current !== handlerSessionId) return;
          const storedWorkflow = await repository.appendObservation(observation);
          if (recordingSessionIdRef.current !== handlerSessionId) return;
          setObservations((current) => [...current, observation]);
          setWorkflows((current) =>
            current.map((item) => (item.id === storedWorkflow.id ? storedWorkflow : item)),
          );
          if (captureContextRef.current)
            captureContextRef.current = { ...captureContextRef.current, workflow: storedWorkflow };
          await refreshStorage();
        },
        onIgnored: (summary, handlerSessionId) => {
          if (recordingSessionIdRef.current === handlerSessionId) setIgnored(summary);
        },
        onError: (message, handlerSessionId) => {
          if (recordingSessionIdRef.current === handlerSessionId) setError(message);
        },
        onLimitReached: async (handlerSessionId) => {
          if (recordingSessionIdRef.current === handlerSessionId) await stopRecording();
        },
      });
    } catch (cause) {
      captureContextRef.current = {
        project: activeProject,
        workflow: activeWorkflow,
        accountContext: activeAccount,
      };
      try {
        await repository.putWorkflow(activeWorkflow);
        setWorkflows((current) =>
          current.map((item) => (item.id === activeWorkflow.id ? activeWorkflow : item)),
        );
      } catch (rollbackCause) {
        throw new Error(
          `${errorMessage(cause)}; workflow rollback also failed: ${errorMessage(rollbackCause)}`,
        );
      }
      throw cause;
    }
    recordingSessionIdRef.current = sessionId;
    setCaptureState("recording");
    setMessage("Recording started. Reload the inspected page to capture its full workflow.");
  }

  function stopRecording(): Promise<void> {
    if (stopPromiseRef.current) return stopPromiseRef.current;
    if (!repository || collectorRef.current.getState() === "idle") return Promise.resolve();
    const sessionId = recordingSessionIdRef.current;
    setCaptureState("stopping");
    const stopping = (async () => {
      const summary = await collectorRef.current.stop();
      const currentContext = captureContextRef.current;
      const workflowToStop = currentContext?.workflow;
      if (!currentContext || !workflowToStop || recordingSessionIdRef.current !== sessionId) return;
      if (currentContext.activeMarker) {
        const ended = await repository.endActionMarker(
          currentContext.activeMarker.id,
          workflowToStop.id,
        );
        setMarkers((current) => current.map((item) => (item.id === ended.id ? ended : item)));
      }
      const updated: Workflow = {
        ...workflowToStop,
        status: "completed",
        endedAt: new Date().toISOString(),
      };
      await repository.putWorkflow(updated);
      if (recordingSessionIdRef.current !== sessionId) return;
      setWorkflows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setActiveMarker(undefined);
      captureContextRef.current = {
        project: currentContext.project,
        workflow: updated,
        accountContext: currentContext.accountContext,
      };
      setLastDrainSummary(summary);
      setMessage(
        `Recording stopped: ${summary.completed} completed, ${summary.timedOut} timed out, ${summary.discarded} discarded.`,
      );
      recordingSessionIdRef.current = undefined;
      setCaptureState("idle");
    })()
      .catch((cause: unknown) => {
        setError(`Recording stop failed: ${errorMessage(cause)}`);
        throw cause;
      })
      .finally(() => {
        if (recordingSessionIdRef.current === sessionId) {
          recordingSessionIdRef.current = undefined;
          setCaptureState("idle");
        }
        stopPromiseRef.current = undefined;
      });
    stopPromiseRef.current = stopping;
    return stopping;
  }

  async function addMarker(label: string, notes?: string): Promise<void> {
    const context = captureContextRef.current;
    if (!repository || captureState !== "recording" || !context) {
      throw new Error("Action markers require an active recording");
    }
    if (!label.trim()) throw new Error("Action marker label cannot be empty");
    if (context.workflow.status !== "recording" || context.workflow.id !== activeWorkflowId) {
      throw new Error("The marker does not belong to the active recording workflow");
    }
    const marker = createActionMarker(context.workflow.id, label, notes);
    const updated = await repository.activateActionMarker(marker, context.activeMarker?.id);
    captureContextRef.current = { ...context, workflow: updated, activeMarker: marker };
    setMarkers((current) => [...current, marker]);
    setWorkflows((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    setActiveMarker(marker);
  }

  async function endActiveMarker(): Promise<void> {
    const context = captureContextRef.current;
    if (!repository || captureState !== "recording" || !context?.activeMarker) return;
    const ended = await repository.endActionMarker(context.activeMarker.id, context.workflow.id);
    captureContextRef.current = {
      project: context.project,
      workflow: context.workflow,
      accountContext: context.accountContext,
    };
    setMarkers((current) => current.map((item) => (item.id === ended.id ? ended : item)));
    setActiveMarker(undefined);
  }

  async function exportProject(): Promise<ExportReceipt> {
    if (!repository || !activeProject) throw new Error("Select a project before exporting");
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
    const receipt = await initiateSanitizedJsonExport(
      bundle,
      `${activeProject.name}-statelens.json`,
    );
    setMessage(
      `Download initiated for ${receipt.filename}. StateLens cannot confirm that the file was saved.`,
    );
    return receipt;
  }

  async function purgeProject(confirmationName: string): Promise<void> {
    if (!repository || !activeProject) throw new Error("Select a project before purging");
    if (captureState !== "idle") throw new Error("Stop and finish draining before purging");
    if (confirmationName !== activeProject.name) {
      throw new Error("Project name confirmation did not match");
    }
    if (
      !window.confirm(
        `Permanently purge local project “${activeProject.name}”? This cannot be undone.`,
      )
    ) {
      throw new Error("Purge cancelled; no records were deleted");
    }
    await repository.purgeProject(activeProject.id);
    const remaining = projects.filter((item) => item.id !== activeProject.id);
    setProjects(remaining);
    setActiveProjectId(remaining[0]?.id);
    setAccounts([]);
    setWorkflows([]);
    setMarkers([]);
    setObservations([]);
    setRecordCounts({
      projects: 0,
      accountContexts: 0,
      workflows: 0,
      actionMarkers: 0,
      observations: 0,
    });
    setMessage("The selected local project and its related records were permanently purged.");
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
    if (captureState !== "idle") {
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
    captureState === "idle" &&
    activeWorkflow.status === "draft" &&
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
          onEndMarker={endActiveMarker}
          activeMarkerLabel={activeMarker?.label}
          captureState={captureState}
          lastDrainSummary={lastDrainSummary}
          onError={setError}
          onActionStart={() => {
            setError(undefined);
            setMessage(undefined);
          }}
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
                disabled={captureState !== "idle"}
                onError={setError}
                onActionStart={() => {
                  setError(undefined);
                  setMessage(undefined);
                }}
                onSelectProject={(id) => selectWhileIdle("project", id)}
                onSelectAccount={(id) => selectWhileIdle("account", id)}
                onSelectWorkflow={(id) => selectWhileIdle("workflow", id)}
                onCreateProject={createProject}
                onAddScope={addScope}
                onCreateAccount={createAccount}
                onCreateWorkflow={createWorkflow}
              />
            )}
            {page === "evidence" &&
              (activeProject ? (
                <EvidenceActions
                  projectName={activeProject.name}
                  counts={recordCounts}
                  captureState={captureState}
                  onExport={exportProject}
                  onPurge={purgeProject}
                  onError={setError}
                  onActionStart={() => {
                    setError(undefined);
                    setMessage(undefined);
                  }}
                />
              ) : (
                <div className="empty-state">
                  <h2>No project selected</h2>
                  <p>Create or select a project before exporting or purging local evidence.</p>
                </div>
              ))}
            {page === "settings" && activeProject && (
              <>
                <LimitSettings
                  limits={activeProject.settings.limits}
                  revealIgnoredHostnames={activeProject.settings.revealIgnoredHostnames}
                  disabled={captureState !== "idle"}
                  onSave={saveProjectSettings}
                  onError={setError}
                  onActionStart={() => {
                    setError(undefined);
                    setMessage(undefined);
                  }}
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
