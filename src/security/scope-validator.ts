import type { ScopeRule } from "../shared/schemas";
import type { ScopeValidationResult } from "../shared/types";

interface HostRuleConstraints {
  hostname: string;
  protocol?: "http:" | "https:";
  port?: string;
  explicitPort: boolean;
}

interface UrlPrefixConstraints extends HostRuleConstraints {
  protocol: "http:" | "https:";
  pathname: string;
}

interface ParsedAuthority {
  hostname: string;
  port?: string;
  explicitPort: boolean;
}

function normalizeHostnameToken(hostname: string): string {
  if (!hostname) throw new Error("Scope hostname is required");
  let parsed: URL;
  try {
    parsed = new URL(`http://${hostname}`);
  } catch {
    throw new Error("Scope host is not a valid hostname");
  }
  const normalized = parsed.hostname.toLowerCase();
  if (!normalized) throw new Error("Scope hostname is required");
  return normalized.startsWith("[") ? normalized : normalized.replace(/\.$/, "");
}

function parseAuthority(authority: string): ParsedAuthority {
  if (!authority) throw new Error("Scope hostname is required");
  if (authority.includes("@")) throw new Error("Scope rules cannot contain user information");
  if (authority.includes("\\")) throw new Error("Scope authority is malformed");

  let hostnameToken: string;
  let portToken: string | undefined;
  let explicitPort = false;
  if (authority.startsWith("[")) {
    const closingBracket = authority.indexOf("]");
    if (closingBracket < 0) throw new Error("Scope contains malformed IPv6");
    hostnameToken = authority.slice(0, closingBracket + 1);
    const remainder = authority.slice(closingBracket + 1);
    if (remainder) {
      if (!remainder.startsWith(":")) throw new Error("Scope contains malformed IPv6");
      explicitPort = true;
      portToken = remainder.slice(1);
    }
  } else {
    if (authority.includes("[") || authority.includes("]")) {
      throw new Error("Scope contains malformed IPv6");
    }
    const colonCount = [...authority].filter((character) => character === ":").length;
    if (colonCount > 1) throw new Error("IPv6 scope literals must use brackets");
    const separator = authority.lastIndexOf(":");
    if (separator >= 0) {
      explicitPort = true;
      hostnameToken = authority.slice(0, separator);
      portToken = authority.slice(separator + 1);
    } else {
      hostnameToken = authority;
    }
  }

  if (explicitPort) {
    if (!portToken || !/^\d+$/.test(portToken)) throw new Error("Scope port is invalid");
    const numericPort = Number(portToken);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65_535) {
      throw new Error("Scope port must be between 1 and 65535");
    }
    portToken = String(numericPort);
  }

  const hostname = normalizeHostnameToken(hostnameToken);
  try {
    new URL(`http://${formatAuthority(hostname, explicitPort ? portToken : undefined)}`);
  } catch {
    throw new Error("Scope authority is invalid");
  }
  return {
    hostname,
    explicitPort,
    ...(explicitPort && portToken ? { port: portToken } : {}),
  };
}

function splitQualified(value: string): {
  protocol: string;
  authority: string;
  suffix: string;
} {
  const match = /^([a-z][a-z\d+.-]*:)[/][/]([^/?#]*)(.*)$/i.exec(value);
  if (!match) throw new Error("Scope must contain a valid scheme and authority");
  return {
    protocol: match[1]!.toLowerCase(),
    authority: match[2]!,
    suffix: match[3]!,
  };
}

function assertWebProtocol(
  protocol: string,
  label: string,
): asserts protocol is "http:" | "https:" {
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
}

function parseHostRule(value: string): HostRuleConstraints {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Scope value is required");
  const qualified = trimmed.includes("://");
  let authority: string;
  let protocol: "http:" | "https:" | undefined;
  if (qualified) {
    const split = splitQualified(trimmed);
    assertWebProtocol(split.protocol, "Host scope");
    protocol = split.protocol;
    authority = split.authority;
    if (split.suffix.includes("?")) throw new Error("Host scope cannot contain a query string");
    if (split.suffix.includes("#")) throw new Error("Host scope cannot contain a fragment");
    if (split.suffix !== "" && split.suffix !== "/") {
      throw new Error("Host scope cannot contain a path");
    }
  } else {
    if (trimmed.includes("?")) throw new Error("Host scope cannot contain a query string");
    if (trimmed.includes("#")) throw new Error("Host scope cannot contain a fragment");
    if (trimmed.includes("/") || trimmed.includes("\\")) {
      throw new Error("Unqualified host scope must contain only a hostname and optional port");
    }
    authority = trimmed;
  }
  const parsed = parseAuthority(authority);
  return { ...parsed, ...(protocol ? { protocol } : {}) };
}

function parseUrlPrefix(value: string): UrlPrefixConstraints {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("URL-prefix scope is required");
  const split = splitQualified(trimmed);
  assertWebProtocol(split.protocol, "URL-prefix scope");
  if (split.suffix.includes("?")) throw new Error("URL-prefix scope cannot contain a query string");
  if (split.suffix.includes("#")) throw new Error("URL-prefix scope cannot contain a fragment");
  if (split.suffix && !split.suffix.startsWith("/")) {
    throw new Error("URL-prefix scope path is malformed");
  }
  const authority = parseAuthority(split.authority);
  const rawPathname = split.suffix || "/";
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(
      `${split.protocol}//${formatAuthority(authority.hostname, authority.port)}${rawPathname}`,
    );
  } catch {
    throw new Error("URL-prefix scope must be a valid absolute URL");
  }
  return { ...authority, protocol: split.protocol, pathname: parsedUrl.pathname };
}

function formatAuthority(hostname: string, port?: string): string {
  return `${hostname}${port ? `:${port}` : ""}`;
}

export function normalizeScopeRuleValue(type: ScopeRule["type"], value: string): string {
  if (type === "url-prefix") {
    const prefix = parseUrlPrefix(value);
    return `${prefix.protocol}//${formatAuthority(prefix.hostname, prefix.port)}${prefix.pathname}`;
  }
  const constraints = parseHostRule(value);
  const authority = formatAuthority(constraints.hostname, constraints.port);
  return constraints.protocol ? `${constraints.protocol}//${authority}` : authority;
}

export function effectivePort(url: URL): string {
  if (url.port) return url.port;
  if (url.protocol === "https:") return "443";
  if (url.protocol === "http:") return "80";
  return "";
}

function hostMatches(
  actualHost: string,
  expectedHost: string,
  includeSubdomains: boolean,
): boolean {
  const actual = normalizeHostnameToken(actualHost);
  if (actual === expectedHost) return true;
  const expectedIsIp = expectedHost.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(expectedHost);
  return !expectedIsIp && includeSubdomains && actual.endsWith(`.${expectedHost}`);
}

function matchesHostRule(url: URL, value: string, includeSubdomains: boolean): boolean {
  const constraints = parseHostRule(value);
  if (!hostMatches(url.hostname, constraints.hostname, includeSubdomains)) return false;
  if (constraints.protocol && url.protocol !== constraints.protocol) return false;
  if (constraints.explicitPort && effectivePort(url) !== constraints.port) return false;
  return true;
}

function matchesRule(url: URL, rule: ScopeRule): boolean {
  try {
    if (rule.type === "exact-host") return matchesHostRule(url, rule.value, false);
    if (rule.type === "subdomain") return matchesHostRule(url, rule.value, true);
    const prefix = parseUrlPrefix(rule.value);
    if (url.protocol !== prefix.protocol) return false;
    if (normalizeHostnameToken(url.hostname) !== prefix.hostname) return false;
    const prefixPort = prefix.explicitPort
      ? prefix.port
      : effectivePort(new URL(`${prefix.protocol}//${prefix.hostname}`));
    if (effectivePort(url) !== prefixPort) return false;
    const pathBoundary = prefix.pathname.endsWith("/") ? prefix.pathname : `${prefix.pathname}/`;
    return url.pathname === prefix.pathname || url.pathname.startsWith(pathBoundary);
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
      normalizedHost: normalizeHostnameToken(url.hostname),
    };
  }
  const match = enabledRules.find((rule) => matchesRule(url, rule));
  if (!match) {
    return {
      allowed: false,
      reason: "URL is outside the active project scope",
      normalizedHost: normalizeHostnameToken(url.hostname),
    };
  }
  return {
    allowed: true,
    matchedRuleId: match.id,
    reason: `Matched ${match.type} rule`,
    normalizedHost: normalizeHostnameToken(url.hostname),
  };
}

export function validateRedirectScope(
  redirectUrl: string | undefined,
  rules: ScopeRule[],
): ScopeValidationResult | undefined {
  return redirectUrl ? validateUrlScope(redirectUrl, rules) : undefined;
}
