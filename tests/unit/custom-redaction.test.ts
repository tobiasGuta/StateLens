import { describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_REDACTION_PATTERN_LENGTH,
  MAX_CUSTOM_REDACTION_PATTERNS,
  validateCustomRedactionPatterns,
} from "../../src/security/custom-redaction";
import { redactText } from "../../src/security/redactor";
import { projectSettingsSchema } from "../../src/shared/schemas";
import { fixtureProject } from "../fixtures/records";

describe("custom redaction pattern safety", () => {
  it("accepts a bounded valid expression", () => {
    expect(validateCustomRedactionPatterns(["customer-[0-9]{3}"])).toEqual(["customer-[0-9]{3}"]);
  });

  it.each([
    [["["], "valid regular expression"],
    [["x".repeat(MAX_CUSTOM_REDACTION_PATTERN_LENGTH + 1)], "exceeds"],
    [
      Array.from({ length: MAX_CUSTOM_REDACTION_PATTERNS + 1 }, (_, index) => `safe-${index}`),
      "At most",
    ],
    [["(a+)+$"], "nested quantifier"],
    [["   "], "cannot be empty"],
  ] as const)("rejects unsafe patterns", (patterns, message) => {
    expect(() => validateCustomRedactionPatterns(patterns)).toThrow(message);
  });

  it("does not persist invalid patterns through the project schema", () => {
    const settings = { ...fixtureProject().settings, customRedactionPatterns: ["(a+)+$"] };
    expect(projectSettingsSchema.safeParse(settings).success).toBe(false);
  });

  it("keeps built-in redaction active when custom settings are invalid", () => {
    const result = redactText("Bearer secret customer-123", ["(a+)+$"]);
    expect(result.value).toBe("Bearer [REDACTED] customer-123");
  });
});
