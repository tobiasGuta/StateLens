import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const failures = [];

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  failures.push(message);
}
function insideDist(path) {
  const rel = relative(dist, path);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("/");
}

const manifestPath = resolve(dist, "manifest.json");
if (!(await exists(manifestPath))) fail("dist/manifest.json is missing");
let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  fail(`dist/manifest.json is invalid: ${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) fail("manifest_version must be 3");
  if (!manifest.devtools_page) fail("manifest.devtools_page is required");
  if (!manifest.background?.service_worker) fail("manifest.background.service_worker is required");
  if (JSON.stringify(manifest.permissions ?? []) !== "[]")
    fail("manifest must not declare Chrome permissions");
  for (const key of ["host_permissions", "optional_permissions", "optional_host_permissions"]) {
    if ((manifest[key] ?? []).length > 0) fail(`manifest must not declare ${key}`);
  }
  const expectedCsp = "script-src 'self'; object-src 'none'; base-uri 'none'";
  if (manifest.content_security_policy?.extension_pages !== expectedCsp) {
    fail(`extension_pages CSP must equal: ${expectedCsp}`);
  }
  const manifestAssets = [
    ["DevTools page", manifest.devtools_page],
    ["service worker", manifest.background?.service_worker],
    ["action popup", manifest.action?.default_popup],
    ...Object.entries(manifest.icons ?? {}).map(([size, value]) => [`icon ${size}`, value]),
    ...Object.entries(manifest.action?.default_icon ?? {}).map(([size, value]) => [
      `action icon ${size}`,
      value,
    ]),
  ];
  for (const [label, value] of manifestAssets) {
    if (!value) continue;
    const path = resolve(dist, value);
    if (!insideDist(path)) fail(`${label} resolves outside dist: ${value}`);
    else if (!(await exists(path))) fail(`${label} does not exist: ${value}`);
  }
}

const files = await listFiles(dist);
const executable = files.filter((path) => /\.(?:js|html|css)$/i.test(path));
const remoteUrl = /https?:\/\/([a-z0-9.-]+)(?=[/:"'`\s])/gi;
const inertStandardsIdentifiers = [
  "http://json-schema.org/draft-04/schema",
  "http://json-schema.org/draft-07/schema",
  "https://json-schema.org/draft/2020-12/schema",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/XML/1998/namespace",
];
for (const path of executable) {
  const text = await readFile(path, "utf8");
  // These exact URI identifiers are used by React DOM and Zod for namespace or
  // schema identity. They are not resource locations and are never fetched.
  const loadableText = inertStandardsIdentifiers.reduce(
    (current, identifier) => current.replaceAll(identifier, "inert-standard-identifier"),
    text,
  );
  for (const match of loadableText.matchAll(remoteUrl)) {
    const host = match[1].toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.endsWith(".test") ||
      host.endsWith(".example") ||
      host.endsWith(".invalid")
    )
      continue;
    fail(`${relative(root, path)} embeds unexpected remote URL host: ${host}`);
  }
  if (/\beval\s*\(/.test(text)) fail(`${relative(root, path)} contains eval()`);
  if (/\bnew\s+Function\s*\(/.test(text)) fail(`${relative(root, path)} contains new Function()`);
  if (/dangerouslySetInnerHTML/.test(text))
    fail(`${relative(root, path)} contains dangerouslySetInnerHTML`);
  if (/sourceMappingURL\s*=/.test(text))
    fail(`${relative(root, path)} contains a source-map reference`);
  if (/(@import|url\()\s*["']?https?:\/\//i.test(text))
    fail(`${relative(root, path)} loads a remote style or font`);
  if (path.endsWith(".html")) {
    for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/gi)) {
      const reference = match[1];
      if (/^(?:https?:)?\/\//i.test(reference) || reference.startsWith("..")) {
        fail(`${relative(root, path)} contains non-local asset reference: ${reference}`);
        continue;
      }
      const asset = resolve(dist, reference.replace(/^\//, ""));
      if (!insideDist(asset) || !(await exists(asset)))
        fail(`${relative(root, path)} references missing asset: ${reference}`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    "Distribution verification failed:\n" + failures.map((item) => `- ${item}`).join("\n"),
  );
  process.exit(1);
}
console.log(
  `Distribution verification passed: ${files.length} packaged files, strict MV3 manifest, local assets only.`,
);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? listFiles(resolve(directory, entry.name))
        : [resolve(directory, entry.name)],
    ),
  );
  return nested.flat().sort();
}
