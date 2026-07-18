export const APP_NAME = "StateLens";
export const DATABASE_NAME = "statelens";
export const DATABASE_VERSION = 1;

export const DEFAULT_LIMITS = {
  maxRequestBodyBytes: 512 * 1024,
  maxResponseBodyBytes: 1024 * 1024,
  maxJsonDepth: 30,
  maxObjectKeys: 10_000,
  maxObservationsPerWorkflow: 5_000,
  projectStorageWarningBytes: 250 * 1024 * 1024,
} as const;

export const SAFE_LIMIT_CEILINGS = {
  maxRequestBodyBytes: 2 * 1024 * 1024,
  maxResponseBodyBytes: 5 * 1024 * 1024,
  maxJsonDepth: 50,
  maxObjectKeys: 25_000,
  maxObservationsPerWorkflow: 20_000,
  projectStorageWarningBytes: 1024 * 1024 * 1024,
} as const;

export const SENSITIVE_FIELD_PATTERN =
  /(?:^|[-_.])(?:authorization|proxy-authorization|cookie|set-cookie|csrf|xsrf|api[-_]?key|access[-_]?token|refresh[-_]?token|bearer|session(?:id)?|password|passwd|client[-_]?secret|private[-_]?key|project[-_]?salt|salt|secret|aws[-_]?access[-_]?key)(?:$|[-_.])/i;

export const PROTOTYPE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
