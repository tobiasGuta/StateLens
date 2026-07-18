import type { ExportReceipt, ProjectBundle } from "../shared/types";
import { redactStructuredValue } from "../security/redactor";
import { sha256Hex } from "../security/token-fingerprint";

export function createSanitizedJsonExport(bundle: ProjectBundle): string {
  return JSON.stringify(redactStructuredValue(bundle).value, null, 2);
}

export function sanitizeFilename(value: string): string {
  const safe = value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return (safe || "statelens-project").slice(0, 100);
}

export function downloadTextFile(
  filename: string,
  content: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeFilename(filename);
  anchor.rel = "noopener";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function initiateSanitizedJsonExport(
  bundle: ProjectBundle,
  requestedFilename: string,
): Promise<ExportReceipt> {
  const content = createSanitizedJsonExport(bundle);
  const filename = sanitizeFilename(requestedFilename);
  const byteSize = new TextEncoder().encode(content).byteLength;
  const sha256 = await sha256Hex(content);
  downloadTextFile(filename, content);
  return { filename, sha256, byteSize };
}
