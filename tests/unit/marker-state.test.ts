import { describe, expect, it } from "vitest";
import { normalizeHarEntry, type HarEntryLike } from "../../src/capture/har-normalizer";
import { mergeMarkerActivation } from "../../src/panel/marker-state";
import { createSanitizedJsonExport } from "../../src/export/json-exporter";
import { fixtureProject, fixtureWorkflow } from "../fixtures/records";

const entry: HarEntryLike = {
  startedDateTime: "2026-07-18T12:00:01.000Z",
  request: { method: "GET", url: "https://api.example.test/action", headers: [] },
  response: { status: 200, headers: [], content: { mimeType: "application/json" } },
};

describe("marker state synchronization", () => {
  it("immediately replaces the visible previous marker without duplicates", () => {
    const previous = {
      id: "marker-1",
      workflowId: "workflow-1",
      label: "First",
      startedAt: "2026-07-18T12:00:00.000Z",
    };
    const endedPrevious = { ...previous, endedAt: "2026-07-18T12:00:01.000Z" };
    const activeMarker = {
      id: "marker-2",
      workflowId: "workflow-1",
      label: "Second",
      startedAt: "2026-07-18T12:00:01.000Z",
    };
    const visible = mergeMarkerActivation([previous, activeMarker], {
      workflow: fixtureWorkflow({ markerIds: [previous.id, activeMarker.id] }),
      activeMarker,
      endedPreviousMarker: endedPrevious,
    });
    expect(visible).toEqual([endedPrevious, activeMarker]);
  });

  it("applies a replacement synchronously and removes an explicitly ended marker", async () => {
    const marker = {
      id: "marker-new",
      workflowId: "workflow-1",
      label: "New active action",
      startedAt: "2026-07-18T12:00:00.500Z",
    };
    const baseContext = {
      project: fixtureProject(),
      workflow: fixtureWorkflow({ markerIds: [marker.id] }),
      accountContext: { id: "account-1", projectId: "project-1", name: "A" },
    };
    const replacementContext = { ...baseContext, activeMarker: marker };
    const afterReplacement = await normalizeHarEntry(
      entry,
      { content: "{}" },
      replacementContext,
      1,
    );
    expect(afterReplacement.actionMarkerId).toBe(marker.id);
    const afterEnd = await normalizeHarEntry(entry, { content: "{}" }, baseContext, 2);
    expect(afterEnd.actionMarkerId).toBeUndefined();
  });

  it("exports the same ended and active marker state visible in the timeline", () => {
    const ended = {
      id: "marker-1",
      workflowId: "workflow-1",
      label: "First",
      startedAt: "2026-07-18T12:00:00.000Z",
      endedAt: "2026-07-18T12:00:01.000Z",
    };
    const active = {
      id: "marker-2",
      workflowId: "workflow-1",
      label: "Second",
      startedAt: "2026-07-18T12:00:01.000Z",
    };
    const output = createSanitizedJsonExport({
      exportedAt: "2026-07-18T12:02:00.000Z",
      formatVersion: 1,
      project: fixtureProject(),
      accountContexts: [],
      workflows: [fixtureWorkflow({ markerIds: [ended.id, active.id] })],
      actionMarkers: [ended, active],
      observations: [],
    });
    const parsed = JSON.parse(output) as { actionMarkers: unknown[] };
    expect(parsed.actionMarkers).toEqual([ended, active]);
  });
});
