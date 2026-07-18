import { afterEach, describe, expect, it, vi } from "vitest";
import { getResponseContent } from "../../src/capture/network-collector";

afterEach(() => {
  vi.useRealTimers();
});

describe("response content retrieval", () => {
  it("returns normal and empty callback content", async () => {
    await expect(
      getResponseContent({ getContent: (callback) => callback("body", "utf8") }, 50),
    ).resolves.toEqual({ content: "body", encoding: "utf8" });
    await expect(
      getResponseContent({ getContent: (callback) => callback("") }, 50),
    ).resolves.toEqual({ content: "" });
  });

  it("converts a thrown callback registration into a safe error", async () => {
    await expect(
      getResponseContent(
        {
          getContent: () => {
            throw new Error("unavailable");
          },
        },
        50,
      ),
    ).resolves.toEqual({ error: "unavailable", errorCode: "response-content-error" });
  });

  it("times out when the callback is never invoked", async () => {
    vi.useFakeTimers();
    const result = getResponseContent({ getContent: () => undefined }, 25);
    await vi.advanceTimersByTimeAsync(25);
    await expect(result).resolves.toEqual({
      error: "Response content retrieval timed out",
      errorCode: "response-content-timeout",
    });
  });

  it("ignores callbacks after timeout and duplicate callbacks", async () => {
    vi.useFakeTimers();
    let callback: ((content?: string) => void) | undefined;
    const late = getResponseContent(
      {
        getContent: (value) => {
          callback = value;
        },
      },
      10,
    );
    await vi.advanceTimersByTimeAsync(10);
    callback?.("late");
    await expect(late).resolves.toMatchObject({ errorCode: "response-content-timeout" });
    const duplicate = getResponseContent(
      {
        getContent: (value) => {
          value("first");
          value("second");
        },
      },
      10,
    );
    await expect(duplicate).resolves.toEqual({ content: "first" });
  });
});
