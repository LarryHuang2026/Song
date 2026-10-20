#!/usr/bin/env node
// C01: auth + model list. C02: probe Suno-related routes using read-only / query requests only.
// Never sends generation requests, so it should not incur generation charges.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv(join(root, ".env.local"));
const key = env.FLUXPORT_API_KEY;
const base = (env.FLUXPORT_BASE_URL || "https://api.uselg.top/v1").replace(/\/+$/, "");
if (!key || key.includes("请替换")) {
  console.error("FLUXPORT_API_KEY 未配置，请编辑 .env.local");
  process.exit(1);
}

const redact = (text) =>
  String(text)
    .split(key).join("[REDACTED_KEY]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "sk-[REDACTED]")
    .replace(/([?&](?:sig|signature|token|x-amz-[a-z-]+|expires)=)[^&\s"]+/gi, "$1[REDACTED]");

async function call(method, url, body) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    return {
      method,
      url,
      requestBody: body ?? null,
      status: res.status,
      contentType: res.headers.get("content-type"),
      isHtml: /^\s*<!doctype html/i.test(text),
      ms: Date.now() - started,
      bodyExcerpt: redact(text.slice(0, 800)),
      _raw: text,
    };
  } catch (err) {
    return { method, url, requestBody: body ?? null, error: String(err), ms: Date.now() - started };
  }
}

const origin = new URL(base).origin;
const mediaBase = "https://api.ai-media.vip/v1";
const mediaOrigin = new URL(mediaBase).origin;
const fakeId = "verify-nonexistent-task-id";

// C01
const models = await call("GET", `${base}/models`);
let modelIds = [];
try {
  const json = JSON.parse(models._raw);
  modelIds = (json.data ?? json.models ?? []).map((m) => m.id ?? m.name ?? m).filter(Boolean);
} catch {}
const musicPattern = /suno|chirp|music|song|udio|lyria|mureka|audio|tts|speech|whisper|riffusion|producer/i;
const musicModels = modelIds.filter((id) => musicPattern.test(String(id)));

const mediaModels = await call("GET", `${mediaBase}/models`);

// C02: query-style probes only
const probes = [];
for (const o of [origin, mediaOrigin]) {
  probes.push(
    ["GET", `${o}/suno/fetch/${fakeId}`],
    ["POST", `${o}/suno/fetch`, { ids: [fakeId] }],
    ["GET", `${o}/v1/suno/fetch/${fakeId}`],
    ["GET", `${o}/suno/v2/fetch?jobId=${fakeId}`],
    ["GET", `${o}/api/v1/suno/task/${fakeId}`],
    ["GET", `${o}/v1/music/tasks/${fakeId}`],
  );
}
const probeResults = [];
for (const [method, url, body] of probes) probeResults.push(await call(method, url, body));

const strip = ({ _raw, ...rest }) => rest;
const result = {
  verifiedAt: new Date().toISOString(),
  base,
  C01: {
    models: strip(models),
    modelCount: modelIds.length,
    allModelIds: modelIds,
    musicOrAudioRelated: musicModels,
    mediaEndpointModels: strip(mediaModels),
  },
  C02: { probes: probeResults.map(strip) },
};

const outDir = join(root, "docs", "api-evidence", `C01-C02-${result.verifiedAt.slice(0, 10)}`);
mkdirSync(outDir, { recursive: true });
const serialized = redact(JSON.stringify(result, null, 2));
if (serialized.includes(key)) throw new Error("redaction failed");
writeFileSync(join(outDir, "result.json"), serialized);

console.log(`C01 GET ${base}/models -> ${models.status ?? models.error}`);
console.log(`  模型总数: ${modelIds.length}`);
console.log(`  音乐/音频相关: ${musicModels.length ? musicModels.join(", ") : "(无)"}`);
console.log(`C01 GET ${mediaBase}/models -> ${mediaModels.status ?? mediaModels.error}`);
console.log("C02 路由探测:");
for (const p of probeResults) {
  const tag = p.error ? p.error : `${p.status}${p.isHtml ? " (HTML 前端页面)" : ""}`;
  console.log(`  ${p.method} ${p.url} -> ${tag}`);
  if (!p.error && !p.isHtml && p.status !== 404) console.log(`    ${p.bodyExcerpt.slice(0, 200).replace(/\n/g, " ")}`);
}
console.log(`证据已保存: ${outDir}/result.json`);
