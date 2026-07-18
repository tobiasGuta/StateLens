import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSanitizedJsonExport,
  initiateSanitizedJsonExport,
  sanitizeFilename,
} from "../../src/export/json-exporter";
import { fixtureProject, fixtureWorkflow } from "../fixtures/records";

describe("sanitized JSON export", () => {
  afterEach(() => vi.restoreAllMocks());
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

  it("reports the hash and size of the exact initiated bytes", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(() => undefined),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const bundle = {
      exportedAt: "2026-07-18T12:00:00.000Z",
      formatVersion: 1 as const,
      project: fixtureProject(),
      accountContexts: [],
      workflows: [],
      actionMarkers: [],
      observations: [],
    };
    const expected = createSanitizedJsonExport(bundle);
    const receipt = await initiateSanitizedJsonExport(bundle, "Example target.json");
    expect(receipt.filename).toBe("Example-target.json");
    expect(receipt.byteSize).toBe(new TextEncoder().encode(expected).byteLength);
    expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});
