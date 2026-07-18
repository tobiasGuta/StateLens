import { describe, expect, it } from "vitest";
import {
  normalizeScopeRuleValue,
  validateRedirectScope,
  validateUrlScope,
} from "../../src/security/scope-validator";
import type { ScopeRule } from "../../src/shared/schemas";

const rule = (type: ScopeRule["type"], value: string): ScopeRule => ({
  id: "rule",
  type,
  value,
  enabled: true,
});

function allowed(type: ScopeRule["type"], value: string, url: string): boolean {
  return validateUrlScope(url, [rule(type, value)]).allowed;
}

describe("scope validation", () => {
  it.each(["exact-host", "subdomain"] as const)(
    "%s scheme-only rules permit default and non-default ports but reject the wrong scheme",
    (type) => {
      expect(allowed(type, "https://example.test", "https://example.test")).toBe(true);
      expect(allowed(type, "https://example.test", "https://example.test:8443/path")).toBe(true);
      expect(allowed(type, "https://example.test", "http://example.test")).toBe(false);
    },
  );

  it.each(["exact-host", "subdomain"] as const)(
    "%s preserves and enforces explicit HTTPS port 443",
    (type) => {
      expect(normalizeScopeRuleValue(type, "HTTPS://Example.TEST.:443/")).toBe(
        "https://example.test:443",
      );
      expect(allowed(type, "https://example.test:443", "https://example.test")).toBe(true);
      expect(allowed(type, "https://example.test:443", "https://example.test:443/path")).toBe(true);
      expect(allowed(type, "https://example.test:443", "https://example.test:8443")).toBe(false);
    },
  );

  it.each(["exact-host", "subdomain"] as const)(
    "%s preserves and enforces explicit HTTP port 80",
    (type) => {
      expect(normalizeScopeRuleValue(type, "http://example.test:80")).toBe(
        "http://example.test:80",
      );
      expect(allowed(type, "http://example.test:80", "http://example.test")).toBe(true);
      expect(allowed(type, "http://example.test:80", "http://example.test:8080")).toBe(false);
      expect(allowed(type, "http://example.test:80", "https://example.test:80")).toBe(false);
    },
  );

  it("pins an explicit non-default subdomain port while matching genuine deep subdomains", () => {
    const value = "https://example.test:8443";
    expect(allowed("subdomain", value, "https://example.test:8443")).toBe(true);
    expect(allowed("subdomain", value, "https://a.b.example.test:8443/path")).toBe(true);
    expect(allowed("subdomain", value, "https://a.example.test:9443")).toBe(false);
  });

  it("matches root and deep subdomains without suffix confusion", () => {
    const value = "example.test";
    expect(allowed("subdomain", value, "https://example.test")).toBe(true);
    expect(allowed("subdomain", value, "http://a.b.example.test:8080")).toBe(true);
    expect(allowed("subdomain", value, "https://notexample.test")).toBe(false);
    expect(allowed("subdomain", value, "https://example-test")).toBe(false);
    expect(allowed("subdomain", value, "https://example.test.evil.test")).toBe(false);
  });

  it("preserves explicit default ports for URL prefixes and pins the origin", () => {
    expect(normalizeScopeRuleValue("url-prefix", "https://example.test:443/api")).toBe(
      "https://example.test:443/api",
    );
    expect(
      allowed("url-prefix", "https://example.test:443/api", "https://example.test/api/x"),
    ).toBe(true);
    expect(
      allowed("url-prefix", "https://example.test:443/api", "https://example.test:8443/api/x"),
    ).toBe(false);
    expect(normalizeScopeRuleValue("url-prefix", "http://example.test:80/api")).toBe(
      "http://example.test:80/api",
    );
    expect(allowed("url-prefix", "http://example.test:80/api", "http://example.test/api")).toBe(
      true,
    );
  });

  it("treats a scheme-only URL prefix as its default origin and enforces path boundaries", () => {
    const value = "https://example.test/api/v1";
    expect(allowed("url-prefix", value, "https://example.test/api/v1")).toBe(true);
    expect(allowed("url-prefix", value, "https://example.test/api/v1/users")).toBe(true);
    expect(allowed("url-prefix", value, "https://example.test:8443/api/v1")).toBe(false);
    expect(allowed("url-prefix", value, "https://example.test/api/v10")).toBe(false);
    expect(allowed("url-prefix", value, "http://example.test/api/v1")).toBe(false);
  });

  it.each([
    ["exact-host", "127.0.0.1", "http://127.0.0.1:8080/path"],
    ["exact-host", "http://localhost:80", "http://localhost/path"],
    ["exact-host", "http://[::1]:80", "http://[::1]/path"],
    ["exact-host", "[::1]", "https://[::1]:8443/path"],
    ["url-prefix", "http://[::1]:80/api", "http://[::1]/api/item"],
  ] as const)("supports %s rule %s", (type, value, url) => {
    expect(allowed(type, value, url)).toBe(true);
  });

  it("normalizes internationalized domains and trailing dots", () => {
    expect(normalizeScopeRuleValue("exact-host", "BÜCHER.example.")).toBe("xn--bcher-kva.example");
    expect(allowed("exact-host", "bücher.example", "https://xn--bcher-kva.example/path")).toBe(
      true,
    );
    expect(allowed("exact-host", "example.test.", "https://EXAMPLE.TEST./path")).toBe(true);
  });

  it.each([
    ["exact-host", "https://user@example.test", "user information"],
    ["exact-host", "https://example.test/path", "path"],
    ["subdomain", "https://example.test?tenant=a", "query string"],
    ["subdomain", "https://example.test#section", "fragment"],
    ["exact-host", "ftp://example.test", "HTTP or HTTPS"],
    ["exact-host", "https://example.test:invalid", "port is invalid"],
    ["exact-host", "https://example.test:0", "between 1 and 65535"],
    ["exact-host", "https://example.test:65536", "between 1 and 65535"],
    ["exact-host", "2001:db8::1", "must use brackets"],
    ["exact-host", "https://[::1", "malformed IPv6"],
    ["url-prefix", "https://user@example.test/api", "user information"],
    ["url-prefix", "https://example.test/api?tenant=a", "query string"],
    ["url-prefix", "https://example.test/api#section", "fragment"],
    ["url-prefix", "https://example.test:0/api", "between 1 and 65535"],
  ] as const)("rejects ambiguous %s input %s", (type, value, message) => {
    expect(() => normalizeScopeRuleValue(type, value)).toThrow(message);
  });

  it("rejects an out-of-scope redirect before content retrieval", () => {
    const result = validateRedirectScope("https://evil.test/callback", [
      rule("subdomain", "example.test"),
    ]);
    expect(result?.allowed).toBe(false);
  });

  it("rejects invalid request URLs, non-web schemes, empty scope, and disabled rules", () => {
    expect(validateUrlScope("not a url", [rule("exact-host", "example.test")]).allowed).toBe(false);
    expect(validateUrlScope("file:///tmp/x", [rule("exact-host", "example.test")]).allowed).toBe(
      false,
    );
    expect(validateUrlScope("https://example.test", []).allowed).toBe(false);
    expect(
      validateUrlScope("https://example.test", [
        { ...rule("exact-host", "example.test"), enabled: false },
      ]).allowed,
    ).toBe(false);
  });
});
