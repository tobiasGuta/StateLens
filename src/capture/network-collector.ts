import { normalizeHarEntry, type HarEntryLike, type ResponseContent } from "./har-normalizer";
import { validateRedirectScope, validateUrlScope } from "../security/scope-validator";
import type {
  CaptureContext,
  CaptureDrainSummary,
  IgnoredRequestSummary,
  RequestObservation,
} from "../shared/types";

interface DevtoolsRequest extends HarEntryLike {
  getContent(callback: (content?: string, encoding?: string) => void): void;
}

interface CollectorCallbacks {
  getContext: () => CaptureContext | undefined;
  onObservation: (observation: RequestObservation, sessionId: string) => Promise<void>;
  onIgnored: (summary: IgnoredRequestSummary, sessionId: string) => void;
  onError: (message: string, sessionId: string) => void;
  onLimitReached: (sessionId: string) => Promise<void>;
}

interface RequestTask {
  stage: "capturing" | "committing" | "settled";
  timedOut: boolean;
  reservationActive: boolean;
  promise: Promise<void>;
}

interface RecordingSession {
  id: string;
  generation: number;
  state: "recording" | "stopping";
  callbacks: CollectorCallbacks;
  seenRequestObjects: WeakSet<object>;
  ignoredCount: number;
  ignoredHostnames: Set<string>;
  tasks: Set<RequestTask>;
  completed: number;
  timedOut: number;
  discarded: number;
  failed: number;
  reservedObservations: number;
  nextSequence: number;
  limitTriggered: boolean;
  stopPromise?: Promise<CaptureDrainSummary>;
}

interface NetworkCollectorOptions {
  drainTimeoutMs?: number;
  responseContentTimeoutMs?: number;
}

export const DEFAULT_DRAIN_TIMEOUT_MS = 4_000;
export const DEFAULT_RESPONSE_CONTENT_TIMEOUT_MS = 2_500;

function isDevtoolsRequest(value: unknown): value is DevtoolsRequest {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.getContent === "function" &&
    typeof record.request === "object" &&
    typeof record.response === "object"
  );
}

export function getResponseContent(
  request: Pick<DevtoolsRequest, "getContent">,
  timeoutMs = DEFAULT_RESPONSE_CONTENT_TIMEOUT_MS,
): Promise<ResponseContent> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    const finish = (result: ResponseContent): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };
    timer = setTimeout(() => {
      finish({
        error: "Response content retrieval timed out",
        errorCode: "response-content-timeout",
      });
    }, timeoutMs);
    try {
      request.getContent((content, encoding) =>
        finish({
          ...(content !== undefined ? { content } : {}),
          ...(encoding ? { encoding } : {}),
        }),
      );
    } catch (error) {
      finish({
        error: error instanceof Error ? error.message : "Response content unavailable",
        errorCode: "response-content-error",
      });
    }
  });
}

export class NetworkCollector {
  private activeSession: RecordingSession | undefined;
  private generation = 0;
  private listening = false;
  private readonly drainTimeoutMs: number;
  private readonly responseContentTimeoutMs: number;

  constructor(options: NetworkCollectorOptions = {}) {
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    this.responseContentTimeoutMs =
      options.responseContentTimeoutMs ?? DEFAULT_RESPONSE_CONTENT_TIMEOUT_MS;
  }

  private readonly listener = (value: unknown): void => {
    const session = this.activeSession;
    if (!session || session.state !== "recording" || !isDevtoolsRequest(value)) return;
    if (session.seenRequestObjects.has(value)) return;
    session.seenRequestObjects.add(value);
    const task = {
      stage: "capturing",
      timedOut: false,
      reservationActive: false,
    } as RequestTask;
    task.promise = this.handleRequest(value, session, task).finally(() => {
      task.stage = "settled";
    });
    session.tasks.add(task);
  };

  start(callbacks: CollectorCallbacks): string {
    if (this.activeSession?.state === "stopping") {
      throw new Error("Cannot start a recording while the previous session is stopping");
    }
    if (this.activeSession?.state === "recording") {
      throw new Error("A recording session is already active");
    }
    const context = callbacks.getContext();
    if (!context) throw new Error("A capture context is required to start recording");
    if (context.workflow.status !== "recording") {
      throw new Error("The capture workflow must be recording before collection starts");
    }
    this.generation += 1;
    const session: RecordingSession = {
      id: `${this.generation}-${crypto.randomUUID()}`,
      generation: this.generation,
      state: "recording",
      callbacks,
      seenRequestObjects: new WeakSet(),
      ignoredCount: 0,
      ignoredHostnames: new Set(),
      tasks: new Set(),
      completed: 0,
      timedOut: 0,
      discarded: 0,
      failed: 0,
      reservedObservations: context.workflow.observationIds.length,
      nextSequence: 1,
      limitTriggered: false,
    };
    this.activeSession = session;
    try {
      chrome.devtools.network.onRequestFinished.addListener(this.listener);
      this.listening = true;
    } catch (error) {
      this.activeSession = undefined;
      throw error;
    }
    return session.id;
  }

  stop(): Promise<CaptureDrainSummary> {
    const session = this.activeSession;
    if (!session) return Promise.resolve(emptyDrainSummary());
    if (session.stopPromise) return session.stopPromise;
    session.state = "stopping";
    this.removeListener();
    session.stopPromise = this.drainSession(session);
    return session.stopPromise;
  }

  getState(): "idle" | "recording" | "stopping" {
    return this.activeSession?.state ?? "idle";
  }

  getSessionId(): string | undefined {
    return this.activeSession?.id;
  }

  private removeListener(): void {
    if (!this.listening) return;
    chrome.devtools.network.onRequestFinished.removeListener(this.listener);
    this.listening = false;
  }

  private isCurrent(session: RecordingSession, task?: RequestTask): boolean {
    return this.activeSession === session && (!task || !task.timedOut);
  }

  private async drainSession(session: RecordingSession): Promise<CaptureDrainSummary> {
    const tasks = [...session.tasks];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.drainTimeoutMs);
    });
    const settled = Promise.allSettled(tasks.map((task) => task.promise)).then(
      () => "settled" as const,
    );
    const result = await Promise.race([settled, timeout]);
    if (timer) clearTimeout(timer);

    if (result === "timeout") {
      for (const task of tasks) {
        if (task.stage === "capturing" && !task.timedOut) {
          task.timedOut = true;
          session.timedOut += 1;
        }
      }
      // Storage commits already admitted before the deadline are allowed to finish;
      // workflow completion waits for them so no observation is written afterwards.
      await Promise.allSettled(
        tasks.filter((task) => task.stage === "committing").map((task) => task.promise),
      );
    }

    if (this.activeSession === session) this.activeSession = undefined;
    return {
      sessionId: session.id,
      completed: session.completed,
      timedOut: session.timedOut,
      discarded: session.discarded,
      failed: session.failed,
      ignoredOutOfScope: session.ignoredCount,
    };
  }

  private async handleRequest(
    value: DevtoolsRequest,
    session: RecordingSession,
    task: RequestTask,
  ): Promise<void> {
    const context = session.callbacks.getContext();
    if (!this.isCurrent(session, task) || !context) return this.discard(session, task);

    const scope = validateUrlScope(value.request.url, context.project.scope);
    const redirectScope = validateRedirectScope(value.response.redirectURL, context.project.scope);
    if (!scope.allowed || (redirectScope && !redirectScope.allowed)) {
      if (!this.isCurrent(session, task)) return this.discard(session, task);
      session.ignoredCount += 1;
      const ignoredHost = !scope.allowed ? scope.normalizedHost : redirectScope?.normalizedHost;
      if (context.project.settings.revealIgnoredHostnames && ignoredHost) {
        session.ignoredHostnames.add(ignoredHost);
      }
      session.callbacks.onIgnored(
        { count: session.ignoredCount, hostnames: [...session.ignoredHostnames].sort() },
        session.id,
      );
      return;
    }

    if (
      session.reservedObservations >= context.project.settings.limits.maxObservationsPerWorkflow
    ) {
      if (!session.limitTriggered && this.isCurrent(session, task)) {
        session.limitTriggered = true;
        const promise = session.callbacks.onLimitReached(session.id);
        void promise.catch((error: unknown) => {
          if (this.isCurrent(session)) {
            session.callbacks.onError(
              error instanceof Error ? error.message : "Failed to stop at observation limit",
              session.id,
            );
          }
        });
      }
      return this.discard(session, task);
    }
    session.reservedObservations += 1;
    task.reservationActive = true;
    const sessionSequence = session.nextSequence;
    session.nextSequence += 1;

    if (!this.isCurrent(session, task)) return this.discard(session, task);
    const responseContent = await getResponseContent(value, this.responseContentTimeoutMs);
    if (!this.isCurrent(session, task)) return this.discard(session, task);

    let observation: RequestObservation;
    try {
      observation = await normalizeHarEntry(value, responseContent, context, sessionSequence);
    } catch (error) {
      this.releaseReservation(session, task);
      if (this.isCurrent(session, task)) {
        this.discard(session, task);
        session.callbacks.onError(
          error instanceof Error ? error.message : "Failed to normalize request",
          session.id,
        );
      }
      return;
    }
    if (!this.isCurrent(session, task)) return this.discard(session, task);
    task.stage = "committing";
    try {
      await session.callbacks.onObservation(observation, session.id);
      session.completed += 1;
    } catch (error) {
      session.failed += 1;
      this.releaseReservation(session, task);
      if (this.isCurrent(session, task)) {
        session.callbacks.onError(
          error instanceof Error ? error.message : "Failed to capture request",
          session.id,
        );
      }
    }
  }

  private discard(session: RecordingSession, task: RequestTask): void {
    if (!task.timedOut) session.discarded += 1;
  }

  private releaseReservation(session: RecordingSession, task: RequestTask): void {
    if (!task.reservationActive) return;
    task.reservationActive = false;
    session.reservedObservations = Math.max(0, session.reservedObservations - 1);
  }
}

function emptyDrainSummary(): CaptureDrainSummary {
  return {
    sessionId: "none",
    completed: 0,
    timedOut: 0,
    discarded: 0,
    failed: 0,
    ignoredOutOfScope: 0,
  };
}
