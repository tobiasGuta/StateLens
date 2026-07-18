import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkCollector } from "../../src/capture/network-collector";
import { fixtureProject, fixtureWorkflow } from "../fixtures/records";

let listener: ((value: unknown) => void) | undefined;
const addListener = vi.fn((callback: (value: unknown) => void) => {
  listener = callback;
});
const removeListener = vi.fn();

beforeEach(() => {
  listener = undefined;
  addListener.mockClear();
  removeListener.mockClear();
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: { devtools: { network: { onRequestFinished: { addListener, removeListener } } } },
  });
});
afterEach(() => {
  Reflect.deleteProperty(globalThis, "chrome");
});

function context(options: { revealIgnoredHostnames?: boolean; maxObservations?: number } = {}) {
  const base = fixtureProject();
  return {
    project: fixtureProject({
      settings: {
        ...base.settings,
        revealIgnoredHostnames: options.revealIgnoredHostnames ?? false,
        limits: {
          ...base.settings.limits,
          maxObservationsPerWorkflow:
            options.maxObservations ?? base.settings.limits.maxObservationsPerWorkflow,
        },
      },
    }),
    workflow: fixtureWorkflow(),
    accountContext: { id: "account-1", projectId: "project-1", name: "A" },
  };
}

function request(
  url: string,
  getContent = vi.fn((callback: (content?: string, encoding?: string) => void) => callback("{}")),
  startedDateTime = "2026-07-18T12:00:00.000Z",
) {
  return {
    startedDateTime,
    time: 1,
    request: { method: "GET", url, headers: [] },
    response: { status: 200, headers: [], content: { mimeType: "application/json" } },
    getContent,
  };
}

function callbacks(getContext = () => context()) {
  return {
    getContext,
    onObservation: vi.fn().mockResolvedValue(undefined),
    onIgnored: vi.fn(),
    onError: vi.fn(),
    onLimitReached: vi.fn().mockResolvedValue(undefined),
  };
}

describe("network collector scope boundary", () => {
  it("does not request or store out-of-scope content", async () => {
    const collector = new NetworkCollector();
    const getContent = vi.fn();
    const events = callbacks();
    collector.start(events);
    listener?.(request("https://evil.test/private", getContent));
    await waitFor(() =>
      expect(events.onIgnored).toHaveBeenCalledWith(
        { count: 1, hostnames: [] },
        expect.any(String),
      ),
    );
    expect(getContent).not.toHaveBeenCalled();
    expect(events.onObservation).not.toHaveBeenCalled();
    await collector.stop();
  });

  it("reveals only ignored hostnames when explicitly enabled", async () => {
    const collector = new NetworkCollector();
    const events = callbacks(() => context({ revealIgnoredHostnames: true }));
    collector.start(events);
    listener?.(request("https://private.evil.test/path?token=secret"));
    await waitFor(() =>
      expect(events.onIgnored).toHaveBeenCalledWith(
        { count: 1, hostnames: ["private.evil.test"] },
        expect.any(String),
      ),
    );
    expect(JSON.stringify(events.onIgnored.mock.calls)).not.toContain("secret");
    await collector.stop();
  });

  it("rejects an out-of-scope redirect before requesting its content", async () => {
    const collector = new NetworkCollector();
    const getContent = vi.fn();
    const events = callbacks(() => context({ revealIgnoredHostnames: true }));
    collector.start(events);
    listener?.({
      ...request("https://api.example.test/redirect", getContent),
      response: {
        status: 302,
        redirectURL: "https://evil.test/callback?token=secret",
        headers: [],
        content: { mimeType: "text/html" },
      },
    });
    await waitFor(() =>
      expect(events.onIgnored).toHaveBeenCalledWith(
        { count: 1, hostnames: ["evil.test"] },
        expect.any(String),
      ),
    );
    expect(getContent).not.toHaveBeenCalled();
    await collector.stop();
  });
});

describe("recording session lifecycle", () => {
  it("returns to idle if Chrome listener registration fails", () => {
    const collector = new NetworkCollector();
    addListener.mockImplementationOnce(() => {
      throw new Error("DevTools listener unavailable");
    });
    expect(() => collector.start(callbacks())).toThrow("DevTools listener unavailable");
    expect(collector.getState()).toBe("idle");
  });

  it("persists a request that finishes before stop", async () => {
    const collector = new NetworkCollector();
    const events = callbacks();
    collector.start(events);
    listener?.(request("https://api.example.test/data"));
    await waitFor(() => expect(events.onObservation).toHaveBeenCalledTimes(1));
    await expect(collector.stop()).resolves.toMatchObject({ completed: 1, timedOut: 0 });
  });

  it("drains a request that finishes after stop begins", async () => {
    let respond: ((content?: string) => void) | undefined;
    const collector = new NetworkCollector({ drainTimeoutMs: 100 });
    const events = callbacks();
    collector.start(events);
    listener?.(
      request(
        "https://api.example.test/slow",
        vi.fn((callback: (content?: string) => void) => {
          respond = callback;
        }),
      ),
    );
    const stopping = collector.stop();
    expect(collector.getState()).toBe("stopping");
    respond?.("{}");
    await expect(stopping).resolves.toMatchObject({ completed: 1, timedOut: 0 });
  });

  it("times out and discards a request that finishes after the drain deadline", async () => {
    let respond: ((content?: string) => void) | undefined;
    const collector = new NetworkCollector({ drainTimeoutMs: 10, responseContentTimeoutMs: 1_000 });
    const events = callbacks();
    collector.start(events);
    listener?.(
      request(
        "https://api.example.test/slow",
        vi.fn((callback: (content?: string) => void) => {
          respond = callback;
        }),
      ),
    );
    const summary = await collector.stop();
    expect(summary).toMatchObject({ completed: 0, timedOut: 1 });
    respond?.("{}");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events.onObservation).not.toHaveBeenCalled();
  });

  it("drains multiple concurrent requests", async () => {
    const responders: ((content?: string) => void)[] = [];
    const collector = new NetworkCollector({ drainTimeoutMs: 100 });
    const events = callbacks();
    collector.start(events);
    listener?.(
      request(
        "https://api.example.test/one",
        vi.fn((callback: (content?: string) => void) => responders.push(callback)),
        "2026-07-18T12:00:00.000Z",
      ),
    );
    listener?.(
      request(
        "https://api.example.test/two",
        vi.fn((callback: (content?: string) => void) => responders.push(callback)),
        "2026-07-18T12:00:01.000Z",
      ),
    );
    const stopping = collector.stop();
    responders.forEach((respond) => respond("{}"));
    await expect(stopping).resolves.toMatchObject({ completed: 2 });
  });

  it("returns the same promise for concurrent stop calls and blocks start while stopping", async () => {
    let respond: ((content?: string) => void) | undefined;
    const collector = new NetworkCollector({ drainTimeoutMs: 100 });
    const events = callbacks();
    collector.start(events);
    listener?.(
      request(
        "https://api.example.test/slow",
        vi.fn((callback: (content?: string) => void) => {
          respond = callback;
        }),
      ),
    );
    const first = collector.stop();
    const second = collector.stop();
    expect(first).toBe(second);
    expect(() => collector.start(events)).toThrow("stopping");
    respond?.("{}");
    await first;
  });

  it("ignores an old-session callback after a new recording starts", async () => {
    let oldRespond: ((content?: string) => void) | undefined;
    const collector = new NetworkCollector({ drainTimeoutMs: 5, responseContentTimeoutMs: 1_000 });
    const oldEvents = callbacks();
    collector.start(oldEvents);
    listener?.(
      request(
        "https://api.example.test/old",
        vi.fn((callback: (content?: string) => void) => {
          oldRespond = callback;
        }),
      ),
    );
    await collector.stop();
    const newEvents = callbacks();
    const newId = collector.start(newEvents);
    oldRespond?.("{}");
    listener?.(request("https://api.example.test/new", undefined, "2026-07-18T12:00:02.000Z"));
    await waitFor(() => expect(newEvents.onObservation).toHaveBeenCalledTimes(1));
    expect(oldEvents.onObservation).not.toHaveBeenCalled();
    expect(newEvents.onObservation.mock.calls[0]?.[1]).toBe(newId);
    await collector.stop();
  });

  it("reserves observation capacity across in-flight requests", async () => {
    let firstRespond: ((content?: string) => void) | undefined;
    const collector = new NetworkCollector({ drainTimeoutMs: 100 });
    const events = callbacks(() => context({ maxObservations: 1 }));
    collector.start(events);
    const secondContent = vi.fn();
    listener?.(
      request(
        "https://api.example.test/one",
        vi.fn((callback: (content?: string) => void) => {
          firstRespond = callback;
        }),
        "2026-07-18T12:00:00.000Z",
      ),
    );
    listener?.(request("https://api.example.test/two", secondContent, "2026-07-18T12:00:01.000Z"));
    await waitFor(() => expect(events.onLimitReached).toHaveBeenCalledTimes(1));
    expect(secondContent).not.toHaveBeenCalled();
    firstRespond?.("{}");
    await collector.stop();
  });
});
