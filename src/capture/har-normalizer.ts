import { parseBody } from "./body-parser";
import { redactHeaders, redactUrl } from "../security/redactor";
import { validateRedirectScope, validateUrlScope } from "../security/scope-validator";
import type { CaptureContext, RequestObservation } from "../shared/types";

export interface HarHeaderLike {
  name: string;
  value?: string;
}

export interface HarEntryLike {
  startedDateTime?: string;
  time?: number;
  request: {
    method: string;
    url: string;
    headers?: HarHeaderLike[];
    queryString?: { name: string; value: string }[];
    postData?: { mimeType?: string; text?: string };
  };
  response: {
    status: number;
    statusText?: string;
    headers?: HarHeaderLike[];
    redirectURL?: string;
    content?: { mimeType?: string };
  };
  _initiator?: { type?: string; url?: string };
}

export interface ResponseContent {
  content?: string;
  encoding?: string;
  error?: string;
  errorCode?: string;
}

export async function normalizeHarEntry(
  entry: HarEntryLike,
  responseContent: ResponseContent,
  context: CaptureContext,
  sessionSequence: number,
): Promise<RequestObservation> {
  const scopeValidation = validateUrlScope(entry.request.url, context.project.scope);
  if (!scopeValidation.allowed) throw new Error("Out-of-scope entries must not be normalized");
  const redirectValidation = validateRedirectScope(
    entry.response.redirectURL,
    context.project.scope,
  );
  const sanitizedUrl = redactUrl(entry.request.url);
  const url = new URL(sanitizedUrl.value);
  const limits = context.project.settings.limits;
  const requestHeaders = await redactHeaders(
    entry.request.headers ?? [],
    context.project.settings.projectSalt,
  );
  const responseHeaders = await redactHeaders(
    entry.response.headers ?? [],
    context.project.settings.projectSalt,
  );
  const requestBody = await parseBody(entry.request.postData?.text, {
    mimeType: entry.request.postData?.mimeType ?? "",
    maxBytes: limits.maxRequestBodyBytes,
    maxDepth: limits.maxJsonDepth,
    maxObjectKeys: limits.maxObjectKeys,
    customRedactionPatterns: context.project.settings.customRedactionPatterns,
  });
  const responseBody = await parseBody(responseContent.content, {
    mimeType: entry.response.content?.mimeType ?? "",
    maxBytes: limits.maxResponseBodyBytes,
    maxDepth: limits.maxJsonDepth,
    maxObjectKeys: limits.maxObjectKeys,
    customRedactionPatterns: context.project.settings.customRedactionPatterns,
    ...(responseContent.encoding ? { encoding: responseContent.encoding } : {}),
  });
  const captureErrors = [...requestBody.errors, ...responseBody.errors];
  if (responseContent.error) {
    captureErrors.push({
      code: responseContent.errorCode ?? "response-content-unavailable",
      message: responseContent.error,
    });
  }
  if (redirectValidation && !redirectValidation.allowed) {
    captureErrors.push({
      code: "out-of-scope-redirect",
      message:
        "The response redirected to an out-of-scope host; redirected content was not captured",
    });
  }
  const requestTruncated =
    requestBody.metadata.state === "truncated" || requestBody.metadata.state === "omitted";
  const responseTruncated =
    responseBody.metadata.state === "truncated" || responseBody.metadata.state === "omitted";
  const redacted =
    sanitizedUrl.redacted ||
    requestHeaders.some((header) => header.redacted) ||
    responseHeaders.some((header) => header.redacted) ||
    requestBody.redacted ||
    responseBody.redacted;
  const queryParameters = [...url.searchParams].map(([name, value]) => ({ name, value }));

  return {
    id: crypto.randomUUID(),
    projectId: context.project.id,
    workflowId: context.workflow.id,
    accountContextId: context.accountContext.id,
    ...(context.activeMarker ? { actionMarkerId: context.activeMarker.id } : {}),
    sessionSequence,
    timestamp: entry.startedDateTime ?? new Date().toISOString(),
    method: entry.request.method.toUpperCase(),
    url: sanitizedUrl.value,
    scheme: url.protocol.slice(0, -1),
    host: url.hostname,
    port: url.port || (url.protocol === "https:" ? "443" : "80"),
    path: url.pathname,
    queryParameters,
    requestHeaders,
    requestBodyMetadata: requestBody.metadata,
    ...(requestBody.parsed !== undefined ? { parsedRequestBody: requestBody.parsed } : {}),
    responseStatus: entry.response.status,
    responseStatusText: entry.response.statusText ?? "",
    responseHeaders,
    responseMimeType: entry.response.content?.mimeType ?? "",
    responseBodyMetadata: responseBody.metadata,
    ...(responseBody.parsed !== undefined ? { parsedResponseBody: responseBody.parsed } : {}),
    ...(responseBody.metadata.hash ? { responseBodyHash: responseBody.metadata.hash } : {}),
    durationMs: Math.max(0, entry.time ?? 0),
    ...(entry._initiator?.type ? { initiator: entry._initiator.type } : {}),
    ...(entry.response.redirectURL
      ? { redirectUrl: redactUrl(entry.response.redirectURL).value }
      : {}),
    extractedIdentifiers: [],
    extractedFields: {},
    securityTags: [
      ...(entry.response.status === 401 || entry.response.status === 403
        ? ["authorization-boundary"]
        : []),
      ...(redirectValidation && !redirectValidation.allowed ? ["out-of-scope-redirect"] : []),
    ],
    redactionStatus: redacted ? "redacted" : "none",
    truncationStatus:
      requestTruncated && responseTruncated
        ? "both"
        : requestTruncated
          ? "request"
          : responseTruncated
            ? "response"
            : "none",
    captureErrors,
    scopeValidation,
  };
}
