import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Verification must be started through npm so npm_execpath is available.");
  process.exit(1);
}
const commands = [
  "format:check",
  "lint",
  "typecheck",
  "test",
  "build",
  "verify:dist",
  "check:forbidden",
];
for (const command of commands) {
  console.log(`\n> npm run ${command}`);
  const result = spawnSync(process.execPath, [npmCli, "run", command], {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) console.error(`Failed to start npm run ${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("\nStateLens verification passed.");
