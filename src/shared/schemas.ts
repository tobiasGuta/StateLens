import { z } from "zod";
import { DEFAULT_LIMITS, SAFE_LIMIT_CEILINGS } from "./constants";
import { validateCustomRedactionPatterns } from "../security/custom-redaction";

const isoDate = z.string().datetime({ offset: true });
const nonEmpty = z.string().trim().min(1);

export const scopeRuleSchema = z
  .object({
    id: nonEmpty,
    type: z.enum(["exact-host", "subdomain", "url-prefix"]),
    value: nonEmpty,
    enabled: z.boolean(),
  })
  .strict();

export const projectLimitsSchema = z
  .object({
    maxRequestBodyBytes: z.number().int().positive().max(SAFE_LIMIT_CEILINGS.maxRequestBodyBytes),
    maxResponseBodyBytes: z.number().int().positive().max(SAFE_LIMIT_CEILINGS.maxResponseBodyBytes),
    maxJsonDepth: z.number().int().positive().max(SAFE_LIMIT_CEILINGS.maxJsonDepth),
    maxObjectKeys: z.number().int().positive().max(SAFE_LIMIT_CEILINGS.maxObjectKeys),
    maxObservationsPerWorkflow: z
      .number()
      .int()
      .positive()
      .max(SAFE_LIMIT_CEILINGS.maxObservationsPerWorkflow),
    projectStorageWarningBytes: z
      .number()
      .int()
      .positive()
      .max(SAFE_LIMIT_CEILINGS.projectStorageWarningBytes),
  })
  .strict();

export const projectSettingsSchema = z
  .object({
    limits: projectLimitsSchema,
    projectSalt: nonEmpty,
    customRedactionPatterns: z
      .array(z.string())
      .superRefine((patterns, context) => {
        try {
          validateCustomRedactionPatterns(patterns);
        } catch (error) {
          context.addIssue({
            code: "custom",
            message: error instanceof Error ? error.message : "Invalid custom redaction patterns",
          });
        }
      })
      .default([]),
    revealIgnoredHostnames: z.boolean().default(false),
  })
  .strict();

export const projectSchema = z
  .object({
    id: nonEmpty,
    name: nonEmpty,
    description: z.string().max(2_000).optional(),
    createdAt: isoDate,
    updatedAt: isoDate,
    scope: z.array(scopeRuleSchema),
    settings: projectSettingsSchema,
  })
  .strict();

export const accountContextSchema = z
  .object({
    id: nonEmpty,
    projectId: nonEmpty,
    name: nonEmpty,
    role: z.string().max(200).optional(),
    tenantLabel: z.string().max(200).optional(),
    notes: z.string().max(4_000).optional(),
  })
  .strict();

export const workflowSchema = z
  .object({
    id: nonEmpty,
    projectId: nonEmpty,
    accountContextId: nonEmpty,
    name: nonEmpty,
    description: z.string().max(2_000).optional(),
    status: z.enum(["draft", "recording", "completed"]),
    startedAt: isoDate.optional(),
    endedAt: isoDate.optional(),
    observationIds: z.array(nonEmpty),
    markerIds: z.array(nonEmpty),
  })
  .strict();

export const actionMarkerSchema = z
  .object({
    id: nonEmpty,
    workflowId: nonEmpty,
    label: nonEmpty,
    notes: z.string().max(4_000).optional(),
    startedAt: isoDate,
    endedAt: isoDate.optional(),
  })
  .strict();

export const capturedHeaderSchema = z
  .object({
    name: nonEmpty,
    value: z.string(),
    redacted: z.boolean(),
    fingerprint: z.string().optional(),
  })
  .strict();

export const bodyMetadataSchema = z
  .object({
    state: z.enum(["empty", "stored", "truncated", "omitted", "unavailable"]),
    byteLength: z.number().int().nonnegative(),
    storedByteLength: z.number().int().nonnegative(),
    hash: z.string().optional(),
    encoding: z.string().optional(),
    reason: z.string().optional(),
  })
  .strict();

export const extractedIdentifierSchema = z
  .object({
    id: nonEmpty,
    observationId: nonEmpty,
    source: z.enum([
      "path",
      "query",
      "request-header",
      "request-body",
      "response-header",
      "response-body",
    ]),
    fieldPath: z.string().optional(),
    rawType: z.enum([
      "integer",
      "uuid",
      "ulid",
      "object-id",
      "slug",
      "opaque-token",
      "graphql-global-id",
      "unknown",
    ]),
    displayValue: z.string(),
    fingerprint: nonEmpty,
    confidence: z.number().min(0).max(1),
    candidateEntityType: z.string().optional(),
  })
  .strict();

export const requestObservationSchema = z
  .object({
    id: nonEmpty,
    projectId: nonEmpty,
    workflowId: nonEmpty,
    accountContextId: nonEmpty,
    actionMarkerId: nonEmpty.optional(),
    timestamp: isoDate,
    method: nonEmpty,
    url: z.string().url(),
    scheme: nonEmpty,
    host: nonEmpty,
    port: z.string(),
    path: nonEmpty,
    queryParameters: z.array(z.object({ name: z.string(), value: z.string() }).strict()),
    requestHeaders: z.array(capturedHeaderSchema),
    requestBodyMetadata: bodyMetadataSchema,
    parsedRequestBody: z.unknown().optional(),
    responseStatus: z.number().int().nonnegative(),
    responseStatusText: z.string(),
    responseHeaders: z.array(capturedHeaderSchema),
    responseMimeType: z.string(),
    responseBodyMetadata: bodyMetadataSchema,
    parsedResponseBody: z.unknown().optional(),
    responseBodyHash: z.string().optional(),
    durationMs: z.number().nonnegative(),
    initiator: z.string().optional(),
    redirectUrl: z.string().optional(),
    extractedIdentifiers: z.array(extractedIdentifierSchema),
    extractedFields: z.record(z.string(), z.unknown()),
    securityTags: z.array(z.string()),
    redactionStatus: z.enum(["none", "redacted"]),
    truncationStatus: z.enum(["none", "request", "response", "both"]),
    captureErrors: z.array(z.object({ code: nonEmpty, message: nonEmpty }).strict()),
    scopeValidation: z
      .object({
        allowed: z.boolean(),
        matchedRuleId: z.string().optional(),
        reason: nonEmpty,
        normalizedHost: z.string().optional(),
      })
      .strict(),
  })
  .strict();

export const recoverableStorageErrorSchema = z
  .object({
    id: nonEmpty,
    storeName: nonEmpty,
    recordId: z.string().optional(),
    message: nonEmpty,
    detectedAt: isoDate,
  })
  .strict();

export type ScopeRule = z.infer<typeof scopeRuleSchema>;
export type ProjectLimits = z.infer<typeof projectLimitsSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type Project = z.infer<typeof projectSchema>;
export type AccountContext = z.infer<typeof accountContextSchema>;
export type Workflow = z.infer<typeof workflowSchema>;
export type ActionMarker = z.infer<typeof actionMarkerSchema>;
export type CapturedHeader = z.infer<typeof capturedHeaderSchema>;
export type BodyMetadata = z.infer<typeof bodyMetadataSchema>;
export type ExtractedIdentifier = z.infer<typeof extractedIdentifierSchema>;
export type RequestObservation = z.infer<typeof requestObservationSchema>;
export type RecoverableStorageError = z.infer<typeof recoverableStorageErrorSchema>;

export const defaultProjectLimits = (): ProjectLimits => ({ ...DEFAULT_LIMITS });
