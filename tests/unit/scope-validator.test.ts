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

describe("scope validation", () => {
  it("matches an exact host but rejects a similar malicious hostname", () => {
    expect(
      validateUrlScope("https://api.example.test/v1", [rule("exact-host", "api.example.test")])
        .allowed,
    ).toBe(true);
    expect(
      validateUrlScope("https://api.example.test.evil.test/v1", [
        rule("exact-host", "api.example.test"),
      ]).allowed,
    ).toBe(false);
  });

  it("matches the root and true subdomains without suffix confusion", () => {
    const rules = [rule("subdomain", "example.test")];
    expect(validateUrlScope("https://example.test", rules).allowed).toBe(true);
    expect(validateUrlScope("https://a.b.example.test/path", rules).allowed).toBe(true);
    expect(validateUrlScope("https://notexample.test/path", rules).allowed).toBe(false);
    expect(validateUrlScope("https://example-test/path", rules).allowed).toBe(false);
    expect(validateUrlScope("https://example.test.evil.test/path", rules).allowed).toBe(false);
  });

  it("pins a supplied subdomain scheme while allowing an unpinned port", () => {
    const rules = [rule("subdomain", "https://example.test")];
    expect(validateUrlScope("https://example.test", rules).allowed).toBe(true);
    expect(validateUrlScope("https://deep.api.example.test:8443/path", rules).allowed).toBe(true);
    expect(validateUrlScope("http://example.test", rules).allowed).toBe(false);
  });

  it("pins a non-default subdomain port and still matches deep subdomains", () => {
    const rules = [rule("subdomain", "https://example.test:8443")];
    expect(validateUrlScope("https://example.test:8443", rules).allowed).toBe(true);
    expect(validateUrlScope("https://a.b.example.test:8443", rules).allowed).toBe(true);
    expect(validateUrlScope("https://example.test:9443", rules).allowed).toBe(false);
    expect(validateUrlScope("http://example.test:8443", rules).allowed).toBe(false);
  });

  it("normalizes explicit default ports, host casing, and trailing dots", () => {
    expect(normalizeScopeRuleValue("subdomain", "HTTPS://Example.TEST.:443/")).toBe(
      "https://example.test",
    );
    const rules = [rule("subdomain", "https://example.test:443")];
    expect(validateUrlScope("https://API.EXAMPLE.TEST.:443/path", rules).allowed).toBe(true);
  });

  it("matches a URL prefix at path boundaries only", () => {
    const rules = [rule("url-prefix", "https://example.test/api/v1")];
    expect(validateUrlScope("https://example.test/api/v1", rules).allowed).toBe(true);
    expect(validateUrlScope("https://example.test/api/v1/users", rules).allowed).toBe(true);
    expect(validateUrlScope("https://example.test/api/v10", rules).allowed).toBe(false);
  });

  it("enforces scheme for scheme-qualified exact hosts and URL prefixes", () => {
    expect(
      validateUrlScope("http://example.test", [rule("exact-host", "https://example.test")]).allowed,
    ).toBe(false);
    expect(
      validateUrlScope("http://example.test/api", [rule("url-prefix", "https://example.test/api")])
        .allowed,
    ).toBe(false);
  });

  it("handles default and explicit non-default ports", () => {
    expect(
      validateUrlScope("https://example.test:443/api", [
        rule("url-prefix", "https://example.test/api"),
      ]).allowed,
    ).toBe(true);
    expect(
      validateUrlScope("https://example.test:8443/api", [
        rule("url-prefix", "https://example.test:8443/api"),
      ]).allowed,
    ).toBe(true);
    expect(
      validateUrlScope("https://example.test:9443/api", [
        rule("url-prefix", "https://example.test:8443/api"),
      ]).allowed,
    ).toBe(false);
    expect(
      validateUrlScope("https://example.test:8443", [
        rule("exact-host", "https://example.test:8443"),
      ]).allowed,
    ).toBe(true);
  });

  it("rejects an out-of-scope redirect", () => {
    const result = validateRedirectScope("https://evil.test/callback", [
      rule("subdomain", "example.test"),
    ]);
    expect(result?.allowed).toBe(false);
  });

  it("normalizes internationalized domains", () => {
    expect(
      validateUrlScope("https://xn--bcher-kva.example/path", [rule("exact-host", "bücher.example")])
        .allowed,
    ).toBe(true);
  });

  it.each([
    ["exact-host", "https://user@example.test", "user information"],
    ["subdomain", "https://example.test?tenant=a", "query string"],
    ["subdomain", "https://example.test#section", "fragment"],
    ["exact-host", "ftp://example.test", "HTTP or HTTPS"],
    ["exact-host", "https://example.test/path", "cannot contain a path"],
    ["url-prefix", "https://example.test/api?tenant=a", "query string"],
    ["url-prefix", "https://example.test/api#section", "fragment"],
  ] as const)("rejects ambiguous %s input %s", (type, value, message) => {
    expect(() => normalizeScopeRuleValue(type, value)).toThrow(message);
  });

  it("normalizes internationalized and trailing-dot host-rule input", () => {
    expect(normalizeScopeRuleValue("exact-host", "BÜCHER.example.")).toBe("xn--bcher-kva.example");
  });

  it("rejects invalid URLs, non-web schemes, empty scope, and disabled rules", () => {
    expect(validateUrlScope("not a url", [rule("exact-host", "example.test")]).reason).toBe(
      "Invalid URL",
    );
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
