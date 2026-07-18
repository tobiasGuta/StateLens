import { describe, expect, it } from "vitest";
import {
  isSensitiveField,
  redactHeaders,
  redactStructuredValue,
  redactText,
  redactUrl,
} from "../../src/security/redactor";

describe("secret redaction", () => {
  it("redacts authorization and proxy authorization with fingerprints", async () => {
    const headers = await redactHeaders(
      [
        { name: "Authorization", value: "Bearer secret-token" },
        { name: "pRoXy-AuThOrIzAtIoN", value: "Basic abc" },
      ],
      "salt",
    );
    expect(headers[0]?.value).toBe("Bearer [REDACTED]");
    expect(headers[0]?.fingerprint).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(headers[1]?.value).toBe("[REDACTED]");
  });

  it("preserves cookie names but not cookie values", async () => {
    const headers = await redactHeaders(
      [
        { name: "Cookie", value: "session=topsecret; theme=dark" },
        { name: "Set-Cookie", value: "sid=serversecret; HttpOnly" },
      ],
      "salt",
    );
    expect(headers[0]?.value).toBe("session=[REDACTED]; theme=[REDACTED]");
    expect(headers[1]?.value).not.toContain("serversecret");
  });

  it("redacts nested passwords, tokens, API keys, CSRF fields, and case variations", () => {
    const result = redactStructuredValue({
      password: "p",
      nested: { accessToken: "a", CsrfToken: "c", APIKey: "k", harmless: "visible" },
    });
    expect(result.value).toEqual({
      password: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        CsrfToken: "[REDACTED]",
        APIKey: "[REDACTED]",
        harmless: "visible",
      },
    });
    expect(result.redacted).toBe(true);
  });

  it("does not redact non-sensitive fields", () => {
    expect(isSensitiveField("monkey")).toBe(false);
    expect(redactStructuredValue({ username: "alice", status: "active" })).toEqual({
      value: { username: "alice", status: "active" },
      redacted: false,
    });
  });

  it("redacts query-string tokens", () => {
    const result = redactUrl("https://example.test/callback?access_token=secret&state=visible");
    expect(new URL(result.value).searchParams.get("access_token")).toBe("[REDACTED]");
    expect(new URL(result.value).searchParams.get("state")).toBe("visible");
  });

  it("does not classify the deterministic session sequence as a secret", () => {
    const result = redactStructuredValue({ sessionSequence: 7, sessionId: "secret" });
    expect(result.value).toEqual({ sessionSequence: 7, sessionId: "[REDACTED]" });
  });

  it("supports a valid custom redaction pattern", () => {
    const result = redactText("customer-code=ABC-123", ["ABC-[0-9]+"]);
    expect(result.value).toBe("customer-code=[REDACTED]");
  });

  it("rejects an unsafe custom set without disabling built-in redaction", () => {
    const result = redactText("customer-code=ABC-123 Authorization: Bearer secret", [
      "ABC-[0-9]+",
      "[",
    ]);
    expect(result.value).toContain("customer-code=ABC-123");
    expect(result.value).not.toContain("secret");
  });

  it("blocks prototype-pollution keys", () => {
    const hostile = JSON.parse(
      '{"safe":1,"__proto__":{"polluted":true},"constructor":"x"}',
    ) as unknown;
    const result = redactStructuredValue(hostile);
    expect(result.value).toEqual({ safe: 1 });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });
});
