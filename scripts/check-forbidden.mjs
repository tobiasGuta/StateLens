import { readFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = resolve(process.env.STATELENS_VERIFY_ROOT ?? resolve(import.meta.dirname, ".."));
const targets = [
  resolve(root, "src"),
  resolve(root, "public"),
  resolve(root, "devtools.html"),
  resolve(root, "panel.html"),
];
const rules = [
  ["eval()", /\beval\s*\(/],
  ["new Function()", /\bnew\s+Function\s*\(/],
  ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
  ["XMLHttpRequest", /\bXMLHttpRequest\b/],
  ["WebSocket", /\bWebSocket\s*\(/],
  ["extension fetch", /\bfetch\s*\(/],
  ["remote script", /<script[^>]+src=["'](?:https?:)?\/\//i],
  ["remote font/style", /(?:@import|url\()\s*["']?https?:\/\//i],
];
const failures = [];
for (const path of await collect(targets)) {
  const text = await readFile(path, "utf8");
  for (const [label, pattern] of rules)
    if (pattern.test(text)) failures.push(`${relative(root, path)}: ${label}`);
}
if (failures.length) {
  console.error(
    "Forbidden source check failed:\n" + failures.map((item) => `- ${item}`).join("\n"),
  );
  process.exit(1);
}
console.log(
  "Forbidden source check passed: no remote execution, request, or unsafe HTML primitives found.",
);

async function collect(paths) {
  const output = [];
  for (const path of paths) {
    if (/\.[a-z]+$/i.test(path)) {
      output.push(path);
      continue;
    }
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) output.push(...(await collect([child])));
      else if (/\.(?:ts|tsx|js|jsx|json|html|css)$/i.test(entry.name)) output.push(child);
    }
  }
  return output.sort();
}
