import type { ScopeRule } from "../shared/schemas";
import type { ScopeValidationResult } from "../shared/types";

function normalizeHostname(hostname: string): string {
  return new URL(`https://${hostname}`).hostname.toLowerCase().replace(/\.$/, "");
}

function defaultPort(protocol: string): string {
  if (protocol === "https:") return "443";
  if (protocol === "http:") return "80";
  return "";
}

function normalizedOrigin(url: URL): string {
  const port = url.port || defaultPort(url.protocol);
  return `${url.protocol}//${normalizeHostname(url.hostname)}:${port}`;
}

function matchesRule(url: URL, rule: ScopeRule): boolean {
  if (rule.type === "exact-host") {
    let expected: URL;
    try {
      expected = rule.value.includes("://")
        ? new URL(rule.value)
        : new URL(`https://${rule.value}`);
    } catch {
      return false;
    }

    const sameHost = normalizeHostname(url.hostname) === normalizeHostname(expected.hostname);
    if (!sameHost) return false;

    if (rule.value.includes("://") && url.protocol !== expected.protocol) return false;
    if (expected.port) {
      return (url.port || defaultPort(url.protocol)) === expected.port;
    }
    return true;
  }

  if (rule.type === "subdomain") {
    const expectedHost = normalizeHostname(
      rule.value.includes("://") ? new URL(rule.value).hostname : rule.value,
    );
    const actualHost = normalizeHostname(url.hostname);
    return actualHost === expectedHost || actualHost.endsWith(`.${expectedHost}`);
  }

  try {
    const prefix = new URL(rule.value);
    if (normalizedOrigin(url) !== normalizedOrigin(prefix)) return false;
    const normalizedPath = prefix.pathname.endsWith("/") ? prefix.pathname : `${prefix.pathname}/`;
    return url.pathname === prefix.pathname || url.pathname.startsWith(normalizedPath);
  } catch {
    return false;
  }
}

export function validateUrlScope(urlValue: string, rules: ScopeRule[]): ScopeValidationResult {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    return { allowed: false, reason: "Invalid URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      allowed: false,
      reason: "Only HTTP and HTTPS traffic can be recorded",
      normalizedHost: url.hostname.toLowerCase(),
    };
  }

  const enabledRules = rules.filter((rule) => rule.enabled);
  if (enabledRules.length === 0) {
    return {
      allowed: false,
      reason: "No enabled scope rule is configured",
      normalizedHost: normalizeHostname(url.hostname),
    };
  }

  const match = enabledRules.find((rule) => matchesRule(url, rule));
  if (!match) {
    return {
      allowed: false,
      reason: "URL is outside the active project scope",
      normalizedHost: normalizeHostname(url.hostname),
    };
  }

  return {
    allowed: true,
    matchedRuleId: match.id,
    reason: `Matched ${match.type} rule`,
    normalizedHost: normalizeHostname(url.hostname),
  };
}

export function validateRedirectScope(
  redirectUrl: string | undefined,
  rules: ScopeRule[],
): ScopeValidationResult | undefined {
  return redirectUrl ? validateUrlScope(redirectUrl, rules) : undefined;
}
