import { PROTOTYPE_KEYS } from "../shared/constants";
import type { BodyParseResult } from "../shared/types";
import { redactStructuredValue, redactText } from "../security/redactor";
import { sha256 } from "../security/token-fingerprint";
import { utf8ByteLength } from "../security/size-limits";

interface ParseOptions {
  mimeType: string;
  maxBytes: number;
  maxDepth: number;
  maxObjectKeys: number;
  customRedactionPatterns?: string[];
  encoding?: string;
}

interface JsonShapeResult {
  valid: boolean;
  reason?: string;
}

function validateJsonShape(value: unknown, maxDepth: number, maxKeys: number): JsonShapeResult {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 1 }];
  let keyCount = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || current.value === null || typeof current.value !== "object") continue;
    if (current.depth > maxDepth) {
      return { valid: false, reason: `JSON exceeds maximum depth of ${maxDepth}` };
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    const entries = Object.entries(current.value);
    keyCount += entries.length;
    if (keyCount > maxKeys) {
      return { valid: false, reason: `JSON exceeds maximum key count of ${maxKeys}` };
    }
    for (const [key, child] of entries) {
      if (PROTOTYPE_KEYS.has(key)) {
        return { valid: false, reason: `JSON contains blocked key: ${key}` };
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return { valid: true };
}

function isJsonMime(mimeType: string): boolean {
  return /(?:^|[/+])json(?:$|;)/i.test(mimeType);
}

function isTextMime(mimeType: string): boolean {
  return /^(?:text\/|application\/(?:xml|graphql|javascript|xhtml\+xml))/i.test(mimeType);
}

function unavailableResult(
  reason: string,
  state: "omitted" | "unavailable" = "unavailable",
): BodyParseResult {
  return {
    metadata: { state, byteLength: 0, storedByteLength: 0, reason },
    redacted: false,
    errors: [],
  };
}

function parseForm(value: string): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = Object.create(null) as Record<
    string,
    string | string[]
  >;
  for (const [key, entry] of new URLSearchParams(value)) {
    if (PROTOTYPE_KEYS.has(key)) continue;
    const existing = result[key];
    result[key] =
      existing === undefined
        ? entry
        : Array.isArray(existing)
          ? [...existing, entry]
          : [existing, entry];
  }
  return result;
}

function parseMultipartMetadata(value: string, mimeType: string): unknown {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(mimeType)?.slice(1).find(Boolean);
  if (!boundary) return { kind: "multipart", parts: [], note: "Boundary unavailable" };
  const parts = value.split(`--${boundary}`).flatMap((part) => {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd < 0) return [];
    const headers = part.slice(0, headerEnd);
    const disposition = /content-disposition:[^\r\n]*/i.exec(headers)?.[0] ?? "";
    const name = /name="([^"]*)"/i.exec(disposition)?.[1] ?? "unnamed";
    const filename = /filename="([^"]*)"/i.exec(disposition)?.[1];
    const contentType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1];
    return [
      {
        name,
        ...(filename ? { filename } : {}),
        ...(contentType ? { contentType } : {}),
        binaryContentOmitted: Boolean(filename),
      },
    ];
  });
  return { kind: "multipart", parts };
}

export async function parseBody(
  value: string | undefined,
  options: ParseOptions,
): Promise<BodyParseResult> {
  if (value === undefined) return unavailableResult("Content was not available");
  if (value.length === 0) {
    return {
      metadata: { state: "empty", byteLength: 0, storedByteLength: 0 },
      redacted: false,
      errors: [],
    };
  }

  const byteLength = utf8ByteLength(value);
  const hash = await sha256(value);
  if (byteLength > options.maxBytes) {
    return {
      metadata: {
        state: "omitted",
        byteLength,
        storedByteLength: 0,
        hash,
        reason: `Body exceeded the ${options.maxBytes.toLocaleString()} byte storage limit`,
      },
      redacted: false,
      errors: [],
    };
  }

  if (options.encoding?.toLowerCase() === "base64") {
    return {
      metadata: {
        state: "omitted",
        byteLength,
        storedByteLength: 0,
        hash,
        encoding: options.encoding,
        reason: "Base64 or binary response content was not stored",
      },
      redacted: false,
      errors: [],
    };
  }

  const mimeType = options.mimeType.toLowerCase();
  const customPatterns = options.customRedactionPatterns ?? [];
  const metadata = { state: "stored" as const, byteLength, storedByteLength: byteLength, hash };
  try {
    if (isJsonMime(mimeType)) {
      const parsed: unknown = JSON.parse(value);
      const shape = validateJsonShape(parsed, options.maxDepth, options.maxObjectKeys);
      if (!shape.valid) {
        return {
          metadata: { ...metadata, state: "omitted", storedByteLength: 0, reason: shape.reason },
          redacted: false,
          errors: [{ code: "unsafe-json-shape", message: shape.reason ?? "Unsafe JSON shape" }],
        };
      }
      const sanitized = redactStructuredValue(parsed, customPatterns);
      return { metadata, parsed: sanitized.value, redacted: sanitized.redacted, errors: [] };
    }

    if (mimeType.includes("application/x-www-form-urlencoded")) {
      const sanitized = redactStructuredValue(parseForm(value), customPatterns);
      return { metadata, parsed: sanitized.value, redacted: sanitized.redacted, errors: [] };
    }

    if (mimeType.includes("multipart/form-data")) {
      const parsed = parseMultipartMetadata(value, options.mimeType);
      return {
        metadata: { ...metadata, storedByteLength: utf8ByteLength(JSON.stringify(parsed)) },
        parsed,
        redacted: false,
        errors: [],
      };
    }

    if (isTextMime(mimeType) || mimeType === "" || mimeType.includes("graphql")) {
      const sanitized = redactText(value, customPatterns);
      return {
        metadata: { ...metadata, storedByteLength: utf8ByteLength(sanitized.value) },
        parsed: sanitized.value,
        sanitizedText: sanitized.value,
        redacted: sanitized.redacted,
        errors: [],
      };
    }

    return {
      metadata: {
        state: "omitted",
        byteLength,
        storedByteLength: 0,
        hash,
        reason: `Unsupported or binary MIME type: ${options.mimeType || "unknown"}`,
      },
      redacted: false,
      errors: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error";
    return {
      metadata: { ...metadata, state: "omitted", storedByteLength: 0, reason: message },
      redacted: false,
      errors: [{ code: "body-parse-failed", message }],
    };
  }
}
