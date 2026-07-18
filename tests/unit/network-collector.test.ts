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

function context(revealIgnoredHostnames = false) {
  return {
    project: fixtureProject({ settings: { ...fixtureProject().settings, revealIgnoredHostnames } }),
    workflow: fixtureWorkflow(),
    accountContext: { id: "account-1", projectId: "project-1", name: "A" },
  };
}

function request(
  url: string,
  getContent = vi.fn((callback: (content?: string, encoding?: string) => void) => callback("{}")),
) {
  return {
    startedDateTime: "2026-07-18T12:00:00.000Z",
    time: 1,
    request: { method: "GET", url, headers: [] },
    response: { status: 200, headers: [], content: { mimeType: "application/json" } },
    getContent,
  };
}

describe("network collector", () => {
  it("does not request or store out-of-scope content", async () => {
    const collector = new NetworkCollector();
    const getContent = vi.fn();
    const onObservation = vi.fn();
    const onIgnored = vi.fn();
    collector.start({
      getContext: () => context(),
      onObservation,
      onIgnored,
      onError: vi.fn(),
      onLimitReached: vi.fn(),
    });
    listener?.(request("https://evil.test/private", getContent));
    await waitFor(() => expect(onIgnored).toHaveBeenCalledWith({ count: 1, hostnames: [] }));
    expect(getContent).not.toHaveBeenCalled();
    expect(onObservation).not.toHaveBeenCalled();
    collector.stop();
  });

  it("reveals only ignored hostnames when explicitly enabled", async () => {
    const collector = new NetworkCollector();
    const onIgnored = vi.fn();
    collector.start({
      getContext: () => context(true),
      onObservation: vi.fn(),
      onIgnored,
      onError: vi.fn(),
      onLimitReached: vi.fn(),
    });
    listener?.(request("https://private.evil.test/path?token=secret"));
    await waitFor(() =>
      expect(onIgnored).toHaveBeenCalledWith({ count: 1, hostnames: ["private.evil.test"] }),
    );
    expect(JSON.stringify(onIgnored.mock.calls)).not.toContain("secret");
    collector.stop();
  });

  it("rejects an out-of-scope redirect before requesting its content", async () => {
    const collector = new NetworkCollector();
    const getContent = vi.fn();
    const onIgnored = vi.fn();
    collector.start({
      getContext: () => context(true),
      onObservation: vi.fn(),
      onIgnored,
      onError: vi.fn(),
      onLimitReached: vi.fn(),
    });
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
      expect(onIgnored).toHaveBeenCalledWith({ count: 1, hostnames: ["evil.test"] }),
    );
    expect(getContent).not.toHaveBeenCalled();
    expect(JSON.stringify(onIgnored.mock.calls)).not.toContain("secret");
    collector.stop();
  });

  it("captures in-scope traffic once and removes its listener on stop", async () => {
    const collector = new NetworkCollector();
    const onObservation = vi.fn().mockResolvedValue(undefined);
    const item = request("https://api.example.test/data");
    collector.start({
      getContext: () => context(),
      onObservation,
      onIgnored: vi.fn(),
      onError: vi.fn(),
      onLimitReached: vi.fn(),
    });
    listener?.(item);
    listener?.(item);
    await waitFor(() => expect(onObservation).toHaveBeenCalledTimes(1));
    collector.stop();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
