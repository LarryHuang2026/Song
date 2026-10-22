#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(path.join(root, ".env.local")))
  process.loadEnvFile(path.join(root, ".env.local"));
const web = path.join(root, "web");
const env = {
  ...process.env,
  MUSIC_PROJECT_ROOT: root,
  NEXT_TELEMETRY_DISABLED: "1",
};
if (!existsSync(path.join(web, "node_modules/next"))) {
  console.error("请先执行 cd web && npm install");
  process.exit(1);
}
for (const args of [["generate"], ["migrate", "deploy"]]) {
  const result = spawnSync(
    process.execPath,
    [path.join(web, "node_modules/prisma/build/index.js"), ...args],
    { cwd: web, env, stdio: "inherit" },
  );
  if (result.status) process.exit(result.status);
}
const children = [
  spawn(
    process.execPath,
    [
      path.join(web, "node_modules/next/dist/bin/next"),
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3100",
    ],
    { cwd: web, env, stdio: "inherit" },
  ),
  spawn(process.execPath, ["--import", "tsx", "src/worker/index.ts"], {
    cwd: web,
    env,
    stdio: "inherit",
  }),
];
const serviceNames = ["Web", "Worker"];
const python = path.join(root, "audio-service/.venv/bin/python");
if (existsSync(python)) {
  const audioUrl = new URL(env.AUDIO_SERVICE_URL || "http://127.0.0.1:8100");
  if (
    audioUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(audioUrl.hostname)
  )
    throw new Error("AUDIO_SERVICE_URL 必须指向本机 HTTP 服务");
  children.push(
    spawn(
      python,
      [
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        audioUrl.port || "80",
      ],
      {
        cwd: path.join(root, "audio-service"),
        env: {
          ...env,
          AUDIO_DATA_ROOT: path.resolve(root, env.MUSIC_DATA_ROOT || "data"),
        },
        stdio: "inherit",
      },
    ),
  );
  serviceNames.push("音频服务");
} else
  console.log(
    "Python 音频服务未安装，已跳过；文字成歌仍可使用（需要 FFmpeg）。",
  );
console.log(
  "\nSong 音乐工作台：http://127.0.0.1:3100\nCtrl+C 停止服务；worker 将等待已提交任务完成并保存结果。\n",
);
let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (!child.pid || child.exitCode !== null || child.signalCode)
            return resolve();
          child.once("exit", resolve);
          child.kill("SIGTERM");
        }),
    ),
  );
  process.exit(exitCode);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
for (const [index, child] of children.entries()) {
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(
        `[${new Date().toISOString()}] ${serviceNames[index]} 退出：code=${code} signal=${signal}，正在停止其他服务`,
      );
      void stop(1);
    }
  });
  child.on("error", (error) => {
    if (!stopping) {
      console.error(
        `[${new Date().toISOString()}] ${serviceNames[index]} 启动失败：${error.message}`,
      );
      void stop(1);
    }
  });
}
