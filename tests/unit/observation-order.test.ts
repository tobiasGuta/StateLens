import { describe, expect, it } from "vitest";
import {
  compareObservations,
  compareWorkflowObservations,
} from "../../src/shared/observation-order";
import { fixtureObservation } from "../fixtures/records";

const timestamp = "2026-07-18T12:00:01.000Z";

describe("observation total ordering", () => {
  it("orders project-wide observations by workflow before session sequence and then ID", () => {
    const observations = [
      fixtureObservation({
        id: "workflow-b",
        workflowId: "workflow-b",
        sessionSequence: 1,
        timestamp,
      }),
      fixtureObservation({ id: "id-b", workflowId: "workflow-a", sessionSequence: 2, timestamp }),
      fixtureObservation({ id: "id-a", workflowId: "workflow-a", sessionSequence: 2, timestamp }),
    ];

    expect(observations.sort(compareObservations).map((observation) => observation.id)).toEqual([
      "id-a",
      "id-b",
      "workflow-b",
    ]);
  });

  it("orders workflow-local observations by sequence before workflow and then ID", () => {
    const observations = [
      fixtureObservation({
        id: "sequence-two",
        workflowId: "workflow-a",
        sessionSequence: 2,
        timestamp,
      }),
      fixtureObservation({ id: "id-b", workflowId: "workflow-b", sessionSequence: 1, timestamp }),
      fixtureObservation({ id: "id-a", workflowId: "workflow-b", sessionSequence: 1, timestamp }),
    ];

    expect(
      observations.sort(compareWorkflowObservations).map((observation) => observation.id),
    ).toEqual(["id-a", "id-b", "sequence-two"]);
  });
});
