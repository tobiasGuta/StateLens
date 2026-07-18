import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSetup } from "../../src/panel/components/ProjectSetup";
import { EvidenceActions } from "../../src/panel/components/EvidenceActions";
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
