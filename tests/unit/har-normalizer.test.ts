import { describe, expect, it } from "vitest";
import { normalizeHarEntry, type HarEntryLike } from "../../src/capture/har-normalizer";
import { fixtureProject, fixtureWorkflow } from "../fixtures/records";

const entry: HarEntryLike = {
  startedDateTime: "2026-07-18T12:00:01.000Z",
  time: 84,
  request: {
    method: "POST",
    url: "https://api.example.test/orders?access_token=query-secret",
    headers: [{ name: "Authorization", value: "Bearer header-secret" }],
    postData: { mimeType: "application/json", text: '{"password":"body-secret","amount":10}' },
  },
  response: {
    status: 201,
    statusText: "Created",
    headers: [{ name: "Set-Cookie", value: "sid=response-secret; HttpOnly" }],
    content: { mimeType: "application/json" },
  },
};

describe("HAR normalization", () => {
  it("normalizes and redacts a completed request before persistence", async () => {
    const observation = await normalizeHarEntry(
      entry,
      { content: '{"accessToken":"response-token","id":"order_1"}' },
      {
        project: fixtureProject(),
        workflow: fixtureWorkflow(),
        accountContext: { id: "account-1", projectId: "project-1", name: "Account A" },
      },
    );
    expect(observation.method).toBe("POST");
    expect(new URL(observation.url).searchParams.get("access_token")).toBe("[REDACTED]");
    expect(observation.requestHeaders[0]?.value).toBe("Bearer [REDACTED]");
    expect(observation.parsedRequestBody).toEqual({ password: "[REDACTED]", amount: 10 });
    expect(observation.parsedResponseBody).toEqual({ accessToken: "[REDACTED]", id: "order_1" });
    expect(JSON.stringify(observation)).not.toContain("header-secret");
    expect(JSON.stringify(observation)).not.toContain("response-secret");
    expect(observation.redactionStatus).toBe("redacted");
  });

  it("refuses normalization for out-of-scope entries", async () => {
    await expect(
      normalizeHarEntry(
        { ...entry, request: { ...entry.request, url: "https://evil.test/orders" } },
        {},
        {
          project: fixtureProject(),
          workflow: fixtureWorkflow(),
          accountContext: { id: "account-1", projectId: "project-1", name: "A" },
        },
      ),
    ).rejects.toThrow("Out-of-scope");
  });

  it("records an out-of-scope redirect without treating it as in-scope content", async () => {
    const observation = await normalizeHarEntry(
      { ...entry, response: { ...entry.response, redirectURL: "https://evil.test/callback" } },
      {},
      {
        project: fixtureProject(),
        workflow: fixtureWorkflow(),
        accountContext: { id: "account-1", projectId: "project-1", name: "A" },
      },
    );
    expect(observation.securityTags).toContain("out-of-scope-redirect");
    expect(observation.captureErrors).toContainEqual(
      expect.objectContaining({ code: "out-of-scope-redirect" }),
    );
  });
});
