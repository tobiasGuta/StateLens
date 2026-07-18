import { describe, expect, it, vi } from "vitest";
import { attemptWorkflowFinalization } from "../../src/panel/finalization-recovery";
import { fixtureProject, fixtureWorkflow } from "../fixtures/records";

const context = {
  project: fixtureProject(),
  workflow: fixtureWorkflow(),
  accountContext: { id: "account-1", projectId: "project-1", name: "Account A" },
};
const summary = {
  sessionId: "session-1",
  completed: 2,
  timedOut: 0,
  discarded: 0,
  failed: 0,
  ignoredOutOfScope: 0,
};

describe("workflow finalization recovery state", () => {
  it("enters finalization-error and preserves context after a write failure", async () => {
    const finalizer = {
      finalizeWorkflow: vi.fn().mockRejectedValue(new Error("IndexedDB final write failed")),
    };
    const attempt = await attemptWorkflowFinalization(
      finalizer,
      context,
      summary,
      "2026-07-18T12:01:00.000Z",
    );
    expect(attempt).toMatchObject({
      state: "finalization-error",
      recovery: {
        context,
        summary,
        error: "IndexedDB final write failed",
      },
    });
  });

  it("supports repeated retry attempts and clears only after success", async () => {
    const completed = { ...context.workflow, status: "completed" as const };
    const finalizer = {
      finalizeWorkflow: vi
        .fn()
        .mockRejectedValueOnce(new Error("first failure"))
        .mockRejectedValueOnce(new Error("second failure"))
        .mockResolvedValueOnce({ workflow: completed, endedMarkers: [] }),
    };
    const first = await attemptWorkflowFinalization(
      finalizer,
      context,
      summary,
      "2026-07-18T12:01:00.000Z",
    );
    const second = await attemptWorkflowFinalization(
      finalizer,
      context,
      summary,
      "2026-07-18T12:01:00.000Z",
    );
    const third = await attemptWorkflowFinalization(
      finalizer,
      context,
      summary,
      "2026-07-18T12:01:00.000Z",
    );
    expect(first.state).toBe("finalization-error");
    expect(second.state).toBe("finalization-error");
    expect(third).toMatchObject({ state: "completed", result: { workflow: completed } });
    expect(finalizer.finalizeWorkflow).toHaveBeenCalledTimes(3);
  });
});
