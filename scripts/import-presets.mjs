#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
if (!existsSync(path.join(web, "node_modules/tsx"))) {
  console.error("请先执行 npm --prefix web ci");
  process.exit(1);
}
const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/import-presets.ts", ...process.argv.slice(2)], {
  cwd: web,
  env: { ...process.env, MUSIC_PROJECT_ROOT: root },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
