import type { ProjectLimits } from "../shared/schemas";
import { SAFE_LIMIT_CEILINGS } from "../shared/constants";

export function clampProjectLimits(limits: ProjectLimits): ProjectLimits {
  return {
    maxRequestBodyBytes: Math.min(
      limits.maxRequestBodyBytes,
      SAFE_LIMIT_CEILINGS.maxRequestBodyBytes,
    ),
    maxResponseBodyBytes: Math.min(
      limits.maxResponseBodyBytes,
      SAFE_LIMIT_CEILINGS.maxResponseBodyBytes,
    ),
    maxJsonDepth: Math.min(limits.maxJsonDepth, SAFE_LIMIT_CEILINGS.maxJsonDepth),
    maxObjectKeys: Math.min(limits.maxObjectKeys, SAFE_LIMIT_CEILINGS.maxObjectKeys),
    maxObservationsPerWorkflow: Math.min(
      limits.maxObservationsPerWorkflow,
      SAFE_LIMIT_CEILINGS.maxObservationsPerWorkflow,
    ),
    projectStorageWarningBytes: Math.min(
      limits.projectStorageWarningBytes,
      SAFE_LIMIT_CEILINGS.projectStorageWarningBytes,
    ),
  };
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
