import { PROTOTYPE_KEYS, SENSITIVE_FIELD_PATTERN } from "../shared/constants";
import type { CapturedHeader } from "../shared/schemas";
import { fingerprintSecret } from "./token-fingerprint";
import { compileSafeCustomPatterns } from "./custom-redaction";

const INLINE_SECRET_PATTERNS = [
  /\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi,
  /\b((?:access|refresh|api|csrf|xsrf)[_-]?(?:token|key)\s*[=:]\s*)[^\s&,;]+/gi,
  /\b(session(?:id)?\s*[=:]\s*)[^\s&,;]+/gi,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
] as const;

export function isSensitiveField(name: string): boolean {
  if (name === "sessionSequence") return false;
  const normalized = name.replace(/([a-z0-9])([A-Z])/g, "$1-$2");
  return (
    SENSITIVE_FIELD_PATTERN.test(name.toLowerCase()) || SENSITIVE_FIELD_PATTERN.test(normalized)
  );
}

export async function redactHeaders(
  headers: readonly { name: string; value?: string }[],
  salt: string,
): Promise<CapturedHeader[]> {
  return Promise.all(
    headers.map(async ({ name, value = "" }) => {
      if (!isSensitiveField(name)) return { name, value, redacted: false };
      const lowerName = name.toLowerCase();
      const displayValue =
        lowerName === "authorization" && /^bearer\s/i.test(value)
          ? "Bearer [REDACTED]"
          : lowerName === "cookie" || lowerName === "set-cookie"
            ? value
                .split(";")
                .map((part) => {
                  const separator = part.indexOf("=");
                  return separator < 0
                    ? part.trim()
                    : `${part.slice(0, separator).trim()}=[REDACTED]`;
                })
                .join("; ")
            : "[REDACTED]";
      return {
        name,
        value: displayValue,
        redacted: true,
        fingerprint: await fingerprintSecret(value, salt),
      };
    }),
  );
}

export function redactText(
  value: string,
  customPatterns: string[] = [],
): {
  value: string;
  redacted: boolean;
} {
  let output = value;
  let redacted = false;
  for (const pattern of INLINE_SECRET_PATTERNS) {
    output = output.replace(pattern, (match, prefix: string | undefined) => {
      redacted = true;
      return prefix ? `${prefix}[REDACTED]` : "[REDACTED]";
    });
  }
  for (const pattern of compileSafeCustomPatterns(customPatterns)) {
    output = output.replace(pattern, () => {
      redacted = true;
      return "[REDACTED]";
    });
  }
  return { value: output, redacted };
}

export function redactStructuredValue(
  input: unknown,
  customPatterns: string[] = [],
  seen = new WeakSet<object>(),
): { value: unknown; redacted: boolean } {
  if (typeof input === "string") {
    return redactText(input, customPatterns);
  }
  if (input === null || typeof input !== "object") {
    return { value: input, redacted: false };
  }
  if (seen.has(input)) return { value: "[CIRCULAR]", redacted: true };
  seen.add(input);

  if (Array.isArray(input)) {
    let redacted = false;
    const value = input.map((item) => {
      const result = redactStructuredValue(item, customPatterns, seen);
      redacted ||= result.redacted;
      return result.value;
    });
    return { value, redacted };
  }

  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let redacted = false;
  for (const [key, value] of Object.entries(input)) {
    if (PROTOTYPE_KEYS.has(key)) {
      redacted = true;
      continue;
    }
    if (isSensitiveField(key)) {
      result[key] = "[REDACTED]";
      redacted = true;
      continue;
    }
    const nested = redactStructuredValue(value, customPatterns, seen);
    result[key] = nested.value;
    redacted ||= nested.redacted;
  }
  return { value: result, redacted };
}

export function redactUrl(rawUrl: string): { value: string; redacted: boolean } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return redactText(rawUrl);
  }

  let redacted = false;
  for (const [name] of url.searchParams) {
    if (isSensitiveField(name)) {
      url.searchParams.set(name, "[REDACTED]");
      redacted = true;
    }
  }
  return { value: url.toString(), redacted };
}
