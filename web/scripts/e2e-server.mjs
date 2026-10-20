import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
const dir = mkdtempSync(path.join(tmpdir(), "song-e2e-"));
const env = {
  ...process.env,
  MUSIC_DATA_ROOT: dir,
  FLUXPORT_API_KEY: "",
  NEXT_TELEMETRY_DISABLED: "1",
  AUDIO_SERVICE_URL: "http://127.0.0.1:8199",
  MUSIC_E2E: "1",
  SUNO_API_KEY: "",
  SUNO_API_BASE_URL: "http://127.0.0.1:8198",
};
const migration = spawnSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "migrate", "deploy"],
  { env, stdio: "inherit" },
);
if (migration.status) {
  rmSync(dir, { recursive: true, force: true });
  process.exit(1);
}
const children = [
  spawn(process.execPath, ["scripts/fake-suno.mjs"], { env, stdio: "inherit" }),
  spawn(
    path.resolve("../audio-service/.venv/bin/python"),
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8199"],
    {
      cwd: path.resolve("../audio-service"),
      env: { ...env, AUDIO_DATA_ROOT: dir },
      stdio: "inherit",
    },
  ),
  spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3199",
    ],
    { env, stdio: "inherit" },
  ),
  spawn(process.execPath, ["--import", "tsx", "src/worker/index.ts"], {
    env,
    stdio: "inherit",
  }),
];
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null) return resolve();
          child.once("exit", resolve);
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 5000).unref();
        }),
    ),
  );
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
for (const child of children)
  child.on("exit", () => {
    if (!closing) void close();
  });
