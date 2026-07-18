export const MAX_CUSTOM_REDACTION_PATTERNS = 20;
export const MAX_CUSTOM_REDACTION_PATTERN_LENGTH = 120;

const NESTED_QUANTIFIER =
  /\((?:\\.|[^()])*?(?:[+*]|\{\d+(?:,\d*)?\})(?:\\.|[^()])*?\)\s*(?:[+*]|\{\d+(?:,\d*)?\})/;

export function validateCustomRedactionPatterns(patterns: readonly string[]): string[] {
  if (patterns.length > MAX_CUSTOM_REDACTION_PATTERNS) {
    throw new Error(
      `At most ${MAX_CUSTOM_REDACTION_PATTERNS} custom redaction patterns are allowed`,
    );
  }
  return patterns.map((pattern, index) => {
    if (!pattern.trim()) throw new Error(`Custom redaction pattern ${index + 1} cannot be empty`);
    if (pattern.length > MAX_CUSTOM_REDACTION_PATTERN_LENGTH) {
      throw new Error(
        `Custom redaction pattern ${index + 1} exceeds ${MAX_CUSTOM_REDACTION_PATTERN_LENGTH} characters`,
      );
    }
    if (NESTED_QUANTIFIER.test(pattern)) {
      throw new Error(
        `Custom redaction pattern ${index + 1} contains a dangerous nested quantifier`,
      );
    }
    try {
      new RegExp(pattern, "gi");
    } catch {
      throw new Error(`Custom redaction pattern ${index + 1} is not a valid regular expression`);
    }
    return pattern;
  });
}

export function compileSafeCustomPatterns(patterns: readonly string[]): RegExp[] {
  try {
    return validateCustomRedactionPatterns(patterns).map((pattern) => new RegExp(pattern, "gi"));
  } catch {
    // Corrupted legacy settings must never disable built-in redaction.
    return [];
  }
}
