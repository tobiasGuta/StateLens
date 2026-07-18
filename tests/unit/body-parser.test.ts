import { describe, expect, it } from "vitest";
import { parseBody } from "../../src/capture/body-parser";

const options = { mimeType: "application/json", maxBytes: 10_000, maxDepth: 5, maxObjectKeys: 20 };

describe("body parser", () => {
  it("parses JSON and redacts before returning persistent data", async () => {
    const result = await parseBody('{"user":"alice","password":"secret"}', options);
    expect(result.parsed).toEqual({ user: "alice", password: "[REDACTED]" });
    expect(result.redacted).toBe(true);
    expect(result.metadata.hash).toBeTruthy();
  });

  it("omits oversized data but retains size and hash metadata", async () => {
    const result = await parseBody("0123456789", {
      ...options,
      mimeType: "text/plain",
      maxBytes: 4,
    });
    expect(result.parsed).toBeUndefined();
    expect(result.metadata).toMatchObject({
      state: "omitted",
      byteLength: 10,
      storedByteLength: 0,
    });
    expect(result.metadata.hash).toBeTruthy();
  });

  it("rejects deep JSON, excessive keys, and prototype keys", async () => {
    const deep = await parseBody('{"a":{"b":{"c":1}}}', { ...options, maxDepth: 2 });
    const wide = await parseBody('{"a":1,"b":2}', { ...options, maxObjectKeys: 1 });
    const hostile = await parseBody('{"__proto__":{"x":1}}', options);
    expect(deep.metadata.state).toBe("omitted");
    expect(wide.metadata.state).toBe("omitted");
    expect(hostile.errors[0]?.code).toBe("unsafe-json-shape");
  });

  it("parses forms and redacts token fields", async () => {
    const result = await parseBody("name=alice&csrfToken=secret&tag=a&tag=b", {
      ...options,
      mimeType: "application/x-www-form-urlencoded",
    });
    expect(result.parsed).toEqual({ name: "alice", csrfToken: "[REDACTED]", tag: ["a", "b"] });
  });

  it("stores multipart metadata without file content", async () => {
    const body =
      '--boundary\r\nContent-Disposition: form-data; name="upload"; filename="secret.txt"\r\nContent-Type: text/plain\r\n\r\nFILE CONTENT\r\n--boundary--';
    const result = await parseBody(body, {
      ...options,
      mimeType: "multipart/form-data; boundary=boundary",
    });
    expect(result.parsed).toEqual({
      kind: "multipart",
      parts: [
        {
          name: "upload",
          filename: "secret.txt",
          contentType: "text/plain",
          binaryContentOmitted: true,
        },
      ],
    });
    expect(JSON.stringify(result.parsed)).not.toContain("FILE CONTENT");
  });

  it("omits binary and base64 content", async () => {
    const binary = await parseBody("raw", { ...options, mimeType: "image/png" });
    const base64 = await parseBody("aGVsbG8=", { ...options, encoding: "base64" });
    expect(binary.metadata.state).toBe("omitted");
    expect(base64.metadata.reason).toContain("binary");
  });

  it("records malformed JSON without throwing", async () => {
    const result = await parseBody("{broken", options);
    expect(result.errors[0]?.code).toBe("body-parse-failed");
  });
});
