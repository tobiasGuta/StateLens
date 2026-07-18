import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const forbiddenScript = resolve(repositoryRoot, "scripts/check-forbidden.mjs");
const distributionScript = resolve(repositoryRoot, "scripts/verify-dist.mjs");
let fixtureRoot: string;

beforeEach(async () => {
  fixtureRoot = await mkdtemp(resolve(tmpdir(), "statelens-verification-"));
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("source security verification", () => {
  it.each([
    ["dangerouslySetInnerHTML", "export const unsafe = { dangerouslySetInnerHTML: {} };"],
    ["eval()", "export const unsafe = eval('1');"],
    ["new Function()", "export const unsafe = new Function('return 1');"],
  ])("rejects StateLens source containing %s", async (label, source) => {
    await createSourceFixture(source);
    const result = run(forbiddenScript);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(label);
  });
});

describe("distribution resource verification", () => {
  it("accepts inert React vendor property and documentation strings", async () => {
    await createDistributionFixture(
      'const vendor="dangerouslySetInnerHTML https://react.dev/errors/418 http://www.w3.org/2000/svg";',
    );
    const result = run(distributionScript);
    expect(result.status, String(result.stderr)).toBe(0);
  });

  it.each([
    ["remote script", '<script src="https://cdn.example.org/app.js"></script>', "devtools.html"],
    [
      "remote stylesheet",
      '<link rel="stylesheet" href="https://cdn.example.org/app.css">',
      "devtools.html",
    ],
    ["remote font", '@font-face{src:url("https://cdn.example.org/font.woff2")}', "assets/app.css"],
    ["source map", "//# sourceMappingURL=panel.js.map", "assets/devtools.js"],
    ["unreferenced executable", "const orphan = true;", "assets/orphan.js"],
  ])("rejects a %s", async (_label, hostileContent, relativePath) => {
    await createDistributionFixture("const safe = true;");
    await writeFile(resolve(fixtureRoot, "dist", relativePath), hostileContent, "utf8");
    const result = run(distributionScript);
    expect(result.status).toBe(1);
  });
});

async function createSourceFixture(source: string): Promise<void> {
  await mkdir(resolve(fixtureRoot, "src"), { recursive: true });
  await mkdir(resolve(fixtureRoot, "public"), { recursive: true });
  await writeFile(resolve(fixtureRoot, "src/owned.ts"), source, "utf8");
  await writeFile(resolve(fixtureRoot, "public/manifest.json"), "{}", "utf8");
  await writeFile(resolve(fixtureRoot, "devtools.html"), "<!doctype html>", "utf8");
  await writeFile(resolve(fixtureRoot, "panel.html"), "<!doctype html>", "utf8");
}

async function createDistributionFixture(vendorCode: string): Promise<void> {
  const dist = resolve(fixtureRoot, "dist");
  await mkdir(resolve(dist, "assets"), { recursive: true });
  await writeFile(
    resolve(dist, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      devtools_page: "devtools.html",
      background: { service_worker: "service-worker.js" },
      permissions: [],
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'",
      },
    }),
    "utf8",
  );
  await writeFile(
    resolve(dist, "devtools.html"),
    '<!doctype html><script type="module" src="/assets/devtools.js"></script>',
    "utf8",
  );
  await writeFile(resolve(dist, "service-worker.js"), "export {};", "utf8");
  await writeFile(resolve(dist, "assets/devtools.js"), vendorCode, "utf8");
}

function run(script: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, STATELENS_VERIFY_ROOT: fixtureRoot },
  });
}
