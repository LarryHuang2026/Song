#!/usr/bin/env node
// ONE generation request through the OpenAI-compatible chat endpoint (incurs one charge).
// Downloads returned audio immediately and records duration via ffprobe.
// Usage: node scripts/probe-chat-music.mjs <model> <label> [prompt | @prompt-file]
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
const key = env.FLUXPORT_API_KEY;
const base = (env.FLUXPORT_BASE_URL || "https://api.uselg.top/v1").replace(/\/+$/, "");
const [model, label = "probe", promptArg] = process.argv.slice(2);
const prompt = promptArg?.startsWith("@")
  ? readFileSync(resolve(promptArg.slice(1)), "utf8").trim()
  : promptArg || "A 30-second cheerful acoustic guitar jingle about morning coffee, female vocal.";
if (!key || !model) {
  console.error("用法: node scripts/probe-chat-music.mjs <model> <label> [prompt | @file]，并确认 .env.local 已配置");
  process.exit(1);
}

const redact = (t) =>
  String(t)
    .split(key).join("[REDACTED_KEY]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]")
    .replace(/(signature=)[^&\s)"]+/gi, "$1[REDACTED]");

function extractLinks(json) {
  const links = [];
  const add = (v) => typeof v === "string" && /^https?:\/\//.test(v) && !links.includes(v) && links.push(v);
  for (const item of Array.isArray(json?.data) ? json.data : []) {
    for (const f of ["url", "download_url", "audio_url"]) add(item?.[f]);
  }
  if (links.length) return links;
  for (const c of json?.choices ?? []) {
    const content = c?.message?.content;
    if (typeof content === "string") {
      for (const m of content.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) add(m[0].replace(/[.,;，。；]+$/, ""));
    }
  }
  return links;
}

const body = { model, stream: false, messages: [{ role: "user", content: prompt }] };
const startedAt = new Date();
const dir = join(root, "docs", "api-evidence", `${label}-${model.replace(/[^\w.-]+/g, "_")}-${startedAt.toISOString().slice(0, 10)}`);
mkdirSync(dir, { recursive: true });

let response;
try {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(660000),
  });
  response = {
    status: res.status,
    requestId: res.headers.get("x-request-id"),
    body: await res.text(),
  };
} catch (err) {
  response = { error: String(err) };
}
response.ms = Date.now() - startedAt.getTime();

const downloads = [];
let parsed;
try {
  parsed = JSON.parse(response.body ?? "");
} catch {}
for (const [i, url] of extractLinks(parsed).entries()) {
  const file = join(dir, `output-${i}.mp3`);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(600000) });
    const type = res.headers.get("content-type") ?? "";
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = /wav/.test(type) ? "wav" : /mpeg|mp3/.test(type) ? "mp3" : "audio";
    const target = file.replace(/\.mp3$/, `.${ext}`);
    writeFileSync(target, buf);
    let probe = null;
    try {
      probe = JSON.parse(
        execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,bit_rate:stream=codec_name,sample_rate,channels", "-of", "json", target]).toString(),
      );
    } catch {}
    downloads.push({ file: target.slice(root.length + 1), contentType: type, bytes: buf.length, downloadMs: Date.now() - t0, probe });
  } catch (err) {
    downloads.push({ url: redact(url), error: String(err) });
  }
}

const out = { startedAt: startedAt.toISOString(), endpoint: `${base}/chat/completions`, request: body, response, downloads };
const serialized = redact(JSON.stringify(out, null, 2));
if (serialized.includes(key)) throw new Error("redaction failed");
writeFileSync(join(dir, "result.json"), serialized);

console.log(`[${model}] status: ${response.status ?? response.error}  生成耗时: ${(response.ms / 1000).toFixed(1)}s`);
if (!downloads.length) console.log(redact(response.body ?? "").slice(0, 1500));
for (const d of downloads) {
  const dur = d.probe?.format?.duration;
  console.log(d.error ? `  下载失败: ${d.error}` : `  ${d.file}  ${dur ? (+dur).toFixed(1) + "s" : "?"}  ${d.contentType}  ${(d.bytes / 1024).toFixed(0)}KB  下载 ${(d.downloadMs / 1000).toFixed(0)}s`);
}
console.log(`证据: ${dir.slice(root.length + 1)}/result.json`);
