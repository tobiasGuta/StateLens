import { describe, expect, it } from "vitest";
import { createSanitizedJsonExport, sanitizeFilename } from "../../src/export/json-exporter";
import { fixtureProject, fixtureWorkflow } from "../fixtures/records";

describe("sanitized JSON export", () => {
  it("applies a final redaction pass", () => {
    const output = createSanitizedJsonExport({
      exportedAt: "2026-07-18T12:00:00.000Z",
      formatVersion: 1,
      project: fixtureProject(),
      accountContexts: [{ id: "a", projectId: "project-1", name: "A", notes: "safe" }],
      workflows: [fixtureWorkflow()],
      actionMarkers: [],
      observations: [],
    });
    expect(output).not.toContain("test-salt");
    expect(output).toContain('"projectSalt": "[REDACTED]"');
  });

  it("sanitizes unsafe filenames", () => {
    expect(sanitizeFilename("../../ My Target : Evidence ")).toBe("My-Target-Evidence");
    expect(sanitizeFilename("***")).toBe("statelens-project");
  });
});
