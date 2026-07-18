import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSetup } from "../../src/panel/components/ProjectSetup";
import { Timeline } from "../../src/panel/components/Timeline";
import { fixtureObservation, fixtureProject } from "../fixtures/records";

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
      />,
    );
    expect(screen.getByText(/Recording is blocked until a scope rule/i)).toBeVisible();
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
