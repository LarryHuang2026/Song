import { readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "./config";
import { registerSecret } from "./secrets";
export const keySchema = z
  .string()
  .trim()
  .min(8, "请输入此服务的 API Key")
  .max(512)
  .regex(/^[A-Za-z0-9._~-]+$/, "Key 不能包含空格或换行");
const savedSchema = z.object({
  key: z.string(),
  verifiedAt: z.string().nullable(),
  disabled: z.boolean().default(false),
});
const settingsFile = path.join(config.dataRoot, "provider-settings.json");
export function sunoOrigin() {
  const url = new URL(
    process.env.SUNO_API_BASE_URL || "https://www.suno-api.io",
  );
  const isTest =
    process.env.MUSIC_E2E === "1" &&
    url.protocol === "http:" &&
    url.hostname === "127.0.0.1";
  if (
    !isTest &&
    (url.origin !== "https://www.suno-api.io" ||
      url.pathname !== "/" ||
      url.username ||
      url.password)
  )
    throw new Error("Suno 服务地址必须为 https://www.suno-api.io");
  return url.origin;
}
export function sunoSettings() {
  let saved: z.infer<typeof savedSchema> | null = null;
  try {
    saved = savedSchema.parse(JSON.parse(readFileSync(settingsFile, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw new Error("AI 服务配置文件无法读取，请重新保存配置");
  }
  const key = saved?.disabled
    ? ""
    : saved?.key || process.env.SUNO_API_KEY || "";
  registerSecret(key);
  return {
    key,
    configured: !!key,
    verifiedAt: saved?.verifiedAt || null,
    source: saved ? "local" : key ? "environment" : "none",
  };
}
export function publicSunoSettings() {
  const { key: _key, ...publicFields } = sunoSettings();
  return {
    ...publicFields,
    provider: "suno-api.io",
    capabilityStatus: "experimental",
    estimatedCost: 0.6,
    origin: "https://www.suno-api.io",
  };
}
export function saveSunoKey(
  key: string,
  verifiedAt: string | null = null,
  disabled = false,
) {
  registerSecret(key);
  const temporary = `${settingsFile}.${randomUUID()}.part`;
  try {
    writeFileSync(temporary, JSON.stringify({ key, verifiedAt, disabled }), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, settingsFile);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {}
  }
}
