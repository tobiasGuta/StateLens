import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSetup } from "../../src/panel/components/ProjectSetup";
import { EvidenceActions } from "../../src/panel/components/EvidenceActions";
import { RecorderBar } from "../../src/panel/components/RecorderBar";
import {
  FinalizationRecoveryPanel,
  InterruptedWorkflowPanel,
} from "../../src/panel/components/RecoveryPanel";
import { Timeline } from "../../src/panel/components/Timeline";
import { normalizeScopeRuleValue } from "../../src/security/scope-validator";
import { fixtureObservation, fixtureProject, fixtureWorkflow } from "../fixtures/records";

describe("MVP components", () => {
  it("shows a visible no-scope warning", () => {
    render(
      <ProjectSetup
        projects={[fixtureProject({ scope: [] })]}
        accounts={[]}
        workflows={[]}
        activeProjectId="project-1"
        onSelectProject={vi.fn()}
        onSelectAccount={vi.fn()}
        onSelectWorkflow={vi.fn()}
        onCreateProject={vi.fn()}
        onAddScope={vi.fn()}
        onCreateAccount={vi.fn()}
        onCreateWorkflow={vi.fn()}
        disabled={false}
        onError={vi.fn()}
        onActionStart={vi.fn()}
      />,
    );
    expect(screen.getByText(/Recording is blocked until a scope rule/i)).toBeVisible();
  });

  it("shows invalid scope errors visibly and preserves the failed input", async () => {
    renderSetup({
      project: fixtureProject({ scope: [] }),
      onAddScope: async (rule) => {
        await Promise.resolve();
        normalizeScopeRuleValue(rule.type, rule.value);
      },
    });
    const input = screen.getByPlaceholderText("example.test");
    fireEvent.change(input, { target: { value: "https://user@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add explicit rule" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("user information");
    expect(input).toHaveValue("https://user@example.test");
  });

  it("surfaces IndexedDB rejection and preserves project form input", async () => {
    renderSetup({ onCreateProject: vi.fn().mockRejectedValue(new Error("IndexedDB unavailable")) });
    const input = screen.getByPlaceholderText("Authorized target");
    fireEvent.change(input, { target: { value: "Synthetic target" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("IndexedDB unavailable");
    expect(input).toHaveValue("Synthetic target");
  });

  it("prevents duplicate submissions and resets only after success", async () => {
    let resolve: (() => void) | undefined;
    const onCreateProject = vi.fn(
      () =>
        new Promise<void>((complete) => {
          resolve = complete;
        }),
    );
    renderSetup({ onCreateProject });
    const input = screen.getByPlaceholderText("Authorized target");
    fireEvent.change(input, { target: { value: "Synthetic target" } });
    const submit = screen.getByRole("button", { name: "Create project" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(onCreateProject).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue("Synthetic target");
    resolve?.();
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("disables context switching while recording is stopping", () => {
    render(
      <ProjectSetup
        projects={[fixtureProject()]}
        accounts={[{ id: "account-1", projectId: "project-1", name: "Account A" }]}
        workflows={[fixtureWorkflow()]}
        activeProjectId="project-1"
        activeAccountId="account-1"
        activeWorkflowId="workflow-1"
        onSelectProject={vi.fn()}
        onSelectAccount={vi.fn()}
        onSelectWorkflow={vi.fn()}
        onCreateProject={vi.fn()}
        onAddScope={vi.fn()}
        onCreateAccount={vi.fn()}
        onCreateWorkflow={vi.fn()}
        disabled
        onError={vi.fn()}
        onActionStart={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Active project")).toBeDisabled();
    expect(screen.getByLabelText("Current context")).toBeDisabled();
    expect(screen.getByLabelText("Selected workflow")).toBeDisabled();
  });

  it("renders markers and lets the analyst select observations", () => {
    const onSelect = vi.fn();
    const observation = fixtureObservation();
    render(
      <Timeline
        observations={[observation]}
        markers={[
          {
            id: "m",
            workflowId: "workflow-1",
            label: "Clicked invoice",
            startedAt: "2026-07-18T12:00:00.500Z",
          },
        ]}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText("Clicked invoice")).toBeVisible();
    fireEvent.click(screen.getByText("/invoices/inv_781"));
    expect(onSelect).toHaveBeenCalledWith(observation);
  });

  it("orders equal-timestamp observations by session sequence", () => {
    const timestamp = "2026-07-18T12:00:01.000Z";
    const { container } = render(
      <Timeline
        observations={[
          fixtureObservation({ id: "second", timestamp, sessionSequence: 2, path: "/second" }),
          fixtureObservation({ id: "first", timestamp, sessionSequence: 1, path: "/first" }),
        ]}
        markers={[]}
        onSelect={vi.fn()}
      />,
    );
    const paths = [...container.querySelectorAll(".timeline-entry.request strong")].map(
      (element) => element.textContent,
    );
    expect(paths).toEqual(["/first", "/second"]);
  });
});

describe("evidence actions", () => {
  const counts = {
    projects: 1,
    accountContexts: 2,
    workflows: 3,
    actionMarkers: 4,
    observations: 5,
  };

  it("never purges when export initiation fails", async () => {
    const onPurge = vi.fn();
    const onError = vi.fn();
    render(
      <EvidenceActions
        projectName="Example target"
        counts={counts}
        captureState="idle"
        purgeBlocked={false}
        onExport={vi.fn().mockRejectedValue(new Error("Download blocked"))}
        onPurge={onPurge}
        onError={onError}
        onActionStart={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Initiate sanitized/i }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Download blocked"));
    expect(onPurge).not.toHaveBeenCalled();
  });

  it("reports an export initiation receipt without claiming save completion", async () => {
    render(
      <EvidenceActions
        projectName="Example target"
        counts={counts}
        captureState="idle"
        purgeBlocked={false}
        onExport={vi
          .fn()
          .mockResolvedValue({ filename: "example.json", sha256: "a".repeat(64), byteSize: 42 })}
        onPurge={vi.fn()}
        onError={vi.fn()}
        onActionStart={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Initiate sanitized/i }));
    expect(await screen.findByText("example.json")).toBeVisible();
    expect(screen.getByText(/save completion is not known/i)).toBeVisible();
  });

  it("requires an exact typed project name before a separate purge", async () => {
    const onPurge = vi.fn().mockResolvedValue(undefined);
    render(
      <EvidenceActions
        projectName="Example target"
        counts={counts}
        captureState="idle"
        purgeBlocked={false}
        onExport={vi.fn()}
        onPurge={onPurge}
        onError={vi.fn()}
        onActionStart={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Begin purge/i }));
    const purge = screen.getByRole("button", { name: /Permanently purge/i });
    expect(purge).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type Example target/i), { target: { value: "Wrong" } });
    expect(purge).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Type Example target/i), {
      target: { value: "Example target" },
    });
    fireEvent.click(purge);
    await waitFor(() => expect(onPurge).toHaveBeenCalledWith("Example target"));
  });

  it("keeps export available while finalization recovery blocks purge", async () => {
    const onExport = vi
      .fn()
      .mockResolvedValue({ filename: "recovery.json", sha256: "b".repeat(64), byteSize: 12 });
    render(
      <EvidenceActions
        projectName="Example target"
        counts={counts}
        captureState="finalization-error"
        purgeBlocked
        onExport={onExport}
        onPurge={vi.fn()}
        onError={vi.fn()}
        onActionStart={vi.fn()}
      />,
    );
    const exportButton = screen.getByRole("button", { name: /Initiate sanitized/i });
    expect(exportButton).toBeEnabled();
    expect(screen.getByRole("button", { name: /Begin purge/i })).toBeDisabled();
    fireEvent.click(exportButton);
    await waitFor(() => expect(onExport).toHaveBeenCalledTimes(1));
  });
});

describe("workflow recovery controls", () => {
  const summary = {
    sessionId: "session-1",
    completed: 2,
    timedOut: 0,
    discarded: 0,
    failed: 0,
    ignoredOutOfScope: 1,
  };

  it("shows finalization failure, blocks recording, and permits repeated retry attempts", async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error("IndexedDB still unavailable"));
    const onError = vi.fn();
    render(
      <>
        <FinalizationRecoveryPanel
          error="Initial finalization failure"
          summary={summary}
          onRetry={onRetry}
          onExport={vi.fn()}
          onError={onError}
        />
        <RecorderBar
          workflow={fixtureWorkflow()}
          canRecord={false}
          ignoredCount={0}
          storageBytes={0}
          onStart={vi.fn()}
          onStop={vi.fn()}
          onMarker={vi.fn()}
          onEndMarker={vi.fn()}
          captureState="finalization-error"
          lastDrainSummary={summary}
          onError={vi.fn()}
          onActionStart={vi.fn()}
        />
      </>,
    );
    expect(screen.getByText("Recording finalization failed")).toBeVisible();
    expect(screen.getByRole("button", { name: "Start recording" })).toBeDisabled();
    const retry = screen.getByRole("button", { name: "Retry finalization" });
    fireEvent.click(retry);
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(retry).toBeEnabled());
    fireEvent.click(retry);
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Initial finalization failure")).toBeVisible();
    expect(onError).toHaveBeenCalledWith("IndexedDB still unavailable");
  });

  it("offers interrupted finalization but prevents casual deletion of non-empty evidence", async () => {
    const onFinalize = vi.fn().mockResolvedValue(undefined);
    render(
      <InterruptedWorkflowPanel
        candidate={{ workflow: fixtureWorkflow(), observationCount: 3, openMarkerCount: 1 }}
        onFinalize={onFinalize}
        onKeep={vi.fn()}
        onDiscard={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Discard empty workflow" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Finalize as interrupted" }));
    await waitFor(() => expect(onFinalize).toHaveBeenCalledTimes(1));
  });
});

interface SetupOptions {
  project?: ReturnType<typeof fixtureProject>;
  onCreateProject?: (name: string, description?: string) => Promise<void>;
  onAddScope?: (rule: {
    type: "exact-host" | "subdomain" | "url-prefix";
    value: string;
  }) => Promise<void>;
}

function renderSetup(options: SetupOptions = {}) {
  function Harness() {
    const [error, setError] = useState<string>();
    return (
      <>
        {error && <div role="alert">{error}</div>}
        <ProjectSetup
          projects={options.project ? [options.project] : []}
          accounts={[]}
          workflows={[]}
          activeProjectId={options.project?.id}
          onSelectProject={vi.fn()}
          onSelectAccount={vi.fn()}
          onSelectWorkflow={vi.fn()}
          onCreateProject={options.onCreateProject ?? vi.fn().mockResolvedValue(undefined)}
          onAddScope={options.onAddScope ?? vi.fn().mockResolvedValue(undefined)}
          onCreateAccount={vi.fn().mockResolvedValue(undefined)}
          onCreateWorkflow={vi.fn().mockResolvedValue(undefined)}
          disabled={false}
          onError={setError}
          onActionStart={() => setError(undefined)}
        />
      </>
    );
  }
  return render(<Harness />);
}
