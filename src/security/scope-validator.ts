import type { ScopeRule } from "../shared/schemas";
import type { ScopeValidationResult } from "../shared/types";

interface HostRuleConstraints {
  hostname: string;
  protocol?: "http:" | "https:";
  port?: string;
}

function normalizeHostname(hostname: string): string {
  const normalized = new URL(`https://${hostname}`).hostname.toLowerCase().replace(/\.$/, "");
  if (!normalized) throw new Error("Scope hostname is required");
  return normalized;
}

function defaultPort(protocol: string): string {
  if (protocol === "https:") return "443";
  if (protocol === "http:") return "80";
  return "";
}

function parseHostRule(value: string): HostRuleConstraints {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Scope value is required");
  const qualified = trimmed.includes("://");
  if (!qualified && /[/\\@?#]/.test(trimmed)) {
    throw new Error("Unqualified host scope must contain only a hostname");
  }

  let url: URL;
  try {
    url = new URL(qualified ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Scope host is not a valid hostname");
  }
  if (qualified && url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Host scope must use HTTP or HTTPS when a scheme is supplied");
  }
  if (url.username || url.password) throw new Error("Scope rules cannot contain user information");
  if (url.pathname !== "/") throw new Error("Host scope cannot contain a path");
  if (url.search) throw new Error("Host scope cannot contain a query string");
  if (url.hash) throw new Error("Host scope cannot contain a fragment");

  const hostname = normalizeHostname(url.hostname);
  return {
    hostname,
    ...(qualified ? { protocol: url.protocol as "http:" | "https:" } : {}),
    // URL normalizes explicit default ports to an empty string. This makes
    // https://host:443 equivalent to https://host, while a non-default port pins.
    ...(url.port ? { port: url.port } : {}),
  };
}

function parseUrlPrefix(value: string): URL {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("URL-prefix scope must be a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL-prefix scope must use HTTP or HTTPS");
  }
  if (url.username || url.password) throw new Error("Scope rules cannot contain user information");
  if (url.search) throw new Error("URL-prefix scope cannot contain a query string");
  if (url.hash) throw new Error("URL-prefix scope cannot contain a fragment");
  url.hostname = normalizeHostname(url.hostname);
  return url;
}

export function normalizeScopeRuleValue(type: ScopeRule["type"], value: string): string {
  if (type === "url-prefix") {
    const url = parseUrlPrefix(value);
    return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}${url.pathname}`;
  }
  const constraints = parseHostRule(value);
  if (!constraints.protocol) return constraints.hostname;
  return `${constraints.protocol}//${constraints.hostname}${constraints.port ? `:${constraints.port}` : ""}`;
}

function normalizedOrigin(url: URL): string {
  return `${url.protocol}//${normalizeHostname(url.hostname)}:${url.port || defaultPort(url.protocol)}`;
}

function hostMatches(
  actualHost: string,
  expectedHost: string,
  includeSubdomains: boolean,
): boolean {
  const actual = normalizeHostname(actualHost);
  if (actual === expectedHost) return true;
  return includeSubdomains && actual.endsWith(`.${expectedHost}`);
}

function matchesHostRule(url: URL, value: string, includeSubdomains: boolean): boolean {
  const constraints = parseHostRule(value);
  if (!hostMatches(url.hostname, constraints.hostname, includeSubdomains)) return false;
  if (constraints.protocol && url.protocol !== constraints.protocol) return false;
  if (constraints.port && url.port !== constraints.port) return false;
  return true;
}

function matchesRule(url: URL, rule: ScopeRule): boolean {
  try {
    if (rule.type === "exact-host") return matchesHostRule(url, rule.value, false);
    if (rule.type === "subdomain") return matchesHostRule(url, rule.value, true);
    const prefix = parseUrlPrefix(rule.value);
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
