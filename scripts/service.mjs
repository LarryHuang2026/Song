#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  chmodSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), "..");
const action = process.argv[2] || "status";
if (process.platform === "win32") {
  console.error(
    "后台脚本仅支持 macOS/Linux；Windows 请使用 node scripts/dev.mjs。",
  );
  process.exit(1);
}
if (
  !["start", "stop", "restart", "status", "logs", "__daemon"].includes(
    action,
  ) ||
  (action !== "__daemon" && process.argv.length > 3)
) {
  console.error(
    "用法：node scripts/service.mjs start|stop|restart|status|logs",
  );
  process.exit(1);
}
const require = createRequire(path.join(root, "web/package.json"));
const statePath = path.join(root, "data/service.json");
const logDir = path.join(root, "data/logs");
const outPath = path.join(logDir, "service.out.log");
const errPath = path.join(logDir, "service.err.log");
let localEnv = {};
if (existsSync(path.join(root, ".env.local")))
  localEnv = require("dotenv").parse(
    readFileSync(path.join(root, ".env.local")),
  );
const audioUrl = new URL(
  process.env.AUDIO_SERVICE_URL ||
    localEnv.AUDIO_SERVICE_URL ||
    "http://127.0.0.1:8100",
);
if (
  audioUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(audioUrl.hostname)
)
  throw new Error("AUDIO_SERVICE_URL 必须指向本机 HTTP 服务");
const hasAudio = existsSync(path.join(root, "audio-service/.venv/bin/python"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function readState() {
  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function running(state) {
  if (!state?.pid || state.pid <= 1 || state.root !== root || !state.token)
    return false;
  try {
    process.kill(state.pid, 0);
  } catch {
    return false;
  }
  const args = spawnSync(
    "/bin/ps",
    ["-p", String(state.pid), "-o", "command="],
    { encoding: "utf8" },
  );
  return (
    args.status === 0 &&
    args.stdout.includes(script) &&
    args.stdout.includes(`__daemon ${state.token}`)
  );
}
function runtime() {
  const candidates = [
    process.env.SONG_NODE_PATH,
    "/opt/homebrew/opt/node@24/bin/node",
    "/usr/local/opt/node@24/bin/node",
    process.execPath,
  ].filter(Boolean);
  for (const node of new Set(candidates)) {
    if (!existsSync(node)) continue;
    const probe = spawnSync(
      node,
      [
        "-e",
        "const D=require('better-sqlite3'); const d=new D(':memory:'); d.close();",
      ],
      { cwd: path.join(root, "web"), encoding: "utf8" },
    );
    if (probe.status === 0) return node;
  }
  throw new Error(
    "没有找到与 SQLite 模块兼容的 Node。请使用 Node 24 重新执行 npm --prefix web ci。",
  );
}
async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}
async function health() {
  let web = false,
    worker = false,
    audio = !hasAudio;
  await Promise.all([
    (async () => {
      try {
        const r = await fetch("http://127.0.0.1:3100/api/state", {
          signal: AbortSignal.timeout(3000),
        });
        if (r.ok) {
          web = true;
          worker = (await r.json()).workerOnline === true;
        }
      } catch {}
    })(),
    (async () => {
      if (!hasAudio) return;
      try {
        const r = await fetch(new URL("/health", audioUrl), {
          signal: AbortSignal.timeout(3000),
        });
        audio = r.ok && (await r.json()).status === "ok";
      } catch {}
    })(),
  ]);
  return { web, worker, audio };
}
function showHealth(info) {
  console.log(
    `Web：${info.web ? "在线" : "离线"}；Worker：${info.worker ? "在线" : "离线"}；音频服务：${hasAudio ? (info.audio ? "在线" : "离线") : "未安装"}`,
  );
}
async function start() {
  const old = readState();
  if (!running(old)) {
    if (
      old &&
      !old.pid &&
      Date.now() - new Date(old.startedAt).getTime() < 60000
    )
      throw new Error("另一个启动命令正在执行，请稍后检查 status。");
    if (
      (await portOpen(3100)) ||
      (hasAudio && (await portOpen(Number(audioUrl.port || 80))))
    )
      throw new Error(
        "服务端口已被其他进程占用。请先停止原来的前台服务，避免启动多个 Worker。",
      );
    const node = runtime();
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
    for (const log of [outPath, errPath]) {
      closeSync(openSync(log, "a", 0o600));
      chmodSync(log, 0o600);
    }
    if (old) unlinkSync(statePath);
    const token = randomUUID();
    writeFileSync(
      statePath,
      JSON.stringify({ root, token, startedAt: new Date().toISOString() }) +
        "\n",
      { flag: "wx", mode: 0o600 },
    );
    const out = openSync(outPath, "a"),
      err = openSync(errPath, "a");
    try {
      const child = spawn(node, [script, "__daemon", token], {
        cwd: root,
        detached: true,
        stdio: ["ignore", out, err],
        env: {
          ...process.env,
          PATH: [
            path.dirname(node),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            process.env.PATH || "/usr/bin:/bin",
          ].join(":"),
        },
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      console.log(`已启动独立后台进程，运行时：${node}`);
    } catch (error) {
      if (readState()?.token === token) unlinkSync(statePath);
      throw error;
    } finally {
      closeSync(out);
      closeSync(err);
    }
  }
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const info = await health();
    if (running(readState()) && info.web && info.worker && info.audio) {
      showHealth(info);
      console.log("后台服务就绪：http://127.0.0.1:3100");
      return;
    }
    await delay(1000);
  }
  showHealth(await health());
  throw new Error(`后台进程未全部就绪，请检查 ${errPath}。`);
}
async function stop() {
  const state = readState();
  if (running(state)) {
    process.kill(state.pid, "SIGTERM");
    const deadline = Date.now() + 60000;
    while (running(state) && Date.now() < deadline) await delay(500);
    if (running(state))
      throw new Error(
        "后台服务仍在等待已提交任务结束，未强制终止；请稍后检查 status。",
      );
  } else if (
    state &&
    !state.pid &&
    Date.now() - new Date(state.startedAt).getTime() < 60000
  )
    throw new Error("后台进程正在启动，请稍后再停止。");
  if (readState()?.token === state?.token && existsSync(statePath))
    unlinkSync(statePath);
  console.log("后台服务已停止，日志已保留。");
}
async function daemon() {
  const token = process.argv[3];
  const state = readState();
  if (!state || !token || state.token !== token || state.root !== root)
    throw new Error("后台启动记录不匹配");
  let stopping = false,
    child;
  const save = (details) => {
    if (readState()?.token === token) {
      const temp = `${statePath}.${process.pid}.tmp`;
      writeFileSync(
        temp,
        JSON.stringify({ ...state, pid: process.pid, ...details }) + "\n",
        { mode: 0o600 },
      );
      renameSync(temp, statePath);
    }
  };
  const stopDaemon = () => {
    stopping = true;
    if (child?.exitCode === null && !child.signalCode) child.kill("SIGTERM");
  };
  process.on("SIGTERM", stopDaemon);
  process.on("SIGINT", stopDaemon);
  process.on("SIGHUP", () => {});
  save({});
  try {
    while (!stopping) {
      console.log(`[${new Date().toISOString()}] 启动 Song 服务组`);
      child = spawn(process.execPath, [path.join(root, "scripts/dev.mjs")], {
        cwd: root,
        detached: true,
        stdio: ["ignore", "inherit", "inherit"],
      });
      save({ childPid: child.pid });
      await new Promise((resolve) => {
        child.once("error", (error) => {
          console.error("服务组启动失败：", error.message);
          resolve();
        });
        child.once("exit", (code, signal) => {
          console.log(
            `[${new Date().toISOString()}] 服务组退出 code=${code} signal=${signal}`,
          );
          resolve();
        });
      });
      // Each service group has its own process group. Clean up orphaned Web,
      // Worker and Python children if the launcher itself exited unexpectedly.
      if (child.pid) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
      if (!stopping) {
        console.error("服务组意外退出，15 秒后重新启动；不自动重提生成请求。");
        for (let i = 0; i < 15 && !stopping; i++) await delay(1000);
      }
    }
  } finally {
    if (readState()?.token === token) unlinkSync(statePath);
  }
}
try {
  if (action === "__daemon") await daemon();
  else if (action === "stop") await stop();
  else if (action === "start") await start();
  else if (action === "restart") {
    await stop();
    await start();
  } else if (action === "logs") {
    console.log(outPath);
    console.log(errPath);
  } else {
    const state = readState();
    console.log(
      `后台托管：${running(state) ? "运行中，PID " + state.pid : "未运行"}`,
    );
    const info = await health();
    showHealth(info);
    if (!(running(state) && info.web && info.worker && info.audio))
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
