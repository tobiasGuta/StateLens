import {
  defaultProjectLimits,
  type Project,
  type RequestObservation,
  type Workflow,
} from "../../src/shared/schemas";

export function fixtureProject(overrides: Partial<Project> = {}): Project {
  const now = "2026-07-18T12:00:00.000Z";
  return {
    id: "project-1",
    name: "Example target",
    createdAt: now,
    updatedAt: now,
    scope: [{ id: "scope-1", type: "exact-host", value: "api.example.test", enabled: true }],
    settings: {
      limits: defaultProjectLimits(),
      projectSalt: "test-salt",
      customRedactionPatterns: [],
      revealIgnoredHostnames: false,
    },
    ...overrides,
  };
}

export function fixtureWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "workflow-1",
    projectId: "project-1",
    accountContextId: "account-1",
    name: "Invoice view",
    status: "recording",
    observationIds: [],
    markerIds: [],
    ...overrides,
  };
}

export function fixtureObservation(
  overrides: Partial<RequestObservation> = {},
): RequestObservation {
  return {
    id: "observation-1",
    projectId: "project-1",
    workflowId: "workflow-1",
    accountContextId: "account-1",
    timestamp: "2026-07-18T12:00:01.000Z",
    method: "GET",
    url: "https://api.example.test/invoices/inv_781",
    scheme: "https",
    host: "api.example.test",
    port: "443",
    path: "/invoices/inv_781",
    queryParameters: [],
    requestHeaders: [],
    requestBodyMetadata: { state: "empty", byteLength: 0, storedByteLength: 0 },
    responseStatus: 200,
    responseStatusText: "OK",
    responseHeaders: [],
    responseMimeType: "application/json",
    responseBodyMetadata: { state: "stored", byteLength: 12, storedByteLength: 12, hash: "hash" },
    parsedResponseBody: { id: "inv_781" },
    responseBodyHash: "hash",
    durationMs: 42,
    extractedIdentifiers: [],
    extractedFields: {},
    securityTags: [],
    redactionStatus: "none",
    truncationStatus: "none",
    captureErrors: [],
    scopeValidation: {
      allowed: true,
      matchedRuleId: "scope-1",
      reason: "Matched exact-host rule",
      normalizedHost: "api.example.test",
    },
    ...overrides,
  };
}
