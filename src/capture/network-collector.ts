import { captureDeduplicationKey, normalizeHarEntry, type HarEntryLike } from "./har-normalizer";
import { validateRedirectScope, validateUrlScope } from "../security/scope-validator";
import type { CaptureContext, IgnoredRequestSummary, RequestObservation } from "../shared/types";

interface DevtoolsRequest extends HarEntryLike {
  getContent(callback: (content?: string, encoding?: string) => void): void;
}

interface CollectorCallbacks {
  getContext: () => CaptureContext | undefined;
  onObservation: (observation: RequestObservation) => Promise<void>;
  onIgnored: (summary: IgnoredRequestSummary) => void;
  onError: (message: string) => void;
  onLimitReached: () => Promise<void>;
}

function isDevtoolsRequest(value: unknown): value is DevtoolsRequest {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.getContent === "function" &&
    typeof record.request === "object" &&
    typeof record.response === "object"
  );
}

export class NetworkCollector {
  private callbacks: CollectorCallbacks | undefined;
  private readonly seen = new Set<string>();
  private ignoredCount = 0;
  private readonly ignoredHostnames = new Set<string>();
  private listening = false;

  private readonly listener = (value: unknown): void => {
    void this.handleRequest(value);
  };

  start(callbacks: CollectorCallbacks): void {
    this.callbacks = callbacks;
    this.seen.clear();
    this.ignoredCount = 0;
    this.ignoredHostnames.clear();
    if (!this.listening) {
      chrome.devtools.network.onRequestFinished.addListener(this.listener);
      this.listening = true;
    }
  }

  stop(): void {
    if (this.listening) {
      chrome.devtools.network.onRequestFinished.removeListener(this.listener);
      this.listening = false;
    }
    this.callbacks = undefined;
  }

  private async handleRequest(value: unknown): Promise<void> {
    const callbacks = this.callbacks;
    const context = callbacks?.getContext();
    if (!callbacks || !context || !isDevtoolsRequest(value)) return;

    const scope = validateUrlScope(value.request.url, context.project.scope);
    const redirectScope = validateRedirectScope(value.response.redirectURL, context.project.scope);
    if (!scope.allowed || (redirectScope && !redirectScope.allowed)) {
      this.ignoredCount += 1;
      const ignoredHost = !scope.allowed ? scope.normalizedHost : redirectScope?.normalizedHost;
      if (context.project.settings.revealIgnoredHostnames && ignoredHost) {
        this.ignoredHostnames.add(ignoredHost);
      }
      callbacks.onIgnored({
        count: this.ignoredCount,
        hostnames: [...this.ignoredHostnames].sort(),
      });
      return;
    }

    if (
      context.workflow.observationIds.length >=
      context.project.settings.limits.maxObservationsPerWorkflow
    ) {
      callbacks.onError(
        "Workflow observation limit reached; recording was stopped to protect local storage.",
      );
      this.stop();
      await callbacks.onLimitReached();
      return;
    }

    const key = captureDeduplicationKey(value);
    if (this.seen.has(key)) return;
    this.seen.add(key);

    const responseContent = await new Promise<{
      content?: string;
      encoding?: string;
      error?: string;
    }>((resolve) => {
      try {
        value.getContent((content, encoding) =>
          resolve({
            ...(content !== undefined ? { content } : {}),
            ...(encoding ? { encoding } : {}),
          }),
        );
      } catch (error) {
        resolve({ error: error instanceof Error ? error.message : "Response content unavailable" });
      }
    });

    try {
      await callbacks.onObservation(await normalizeHarEntry(value, responseContent, context));
    } catch (error) {
      callbacks.onError(error instanceof Error ? error.message : "Failed to capture request");
    }
  }
}
