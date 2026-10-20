import { z } from "zod";
import { config } from "./config";
import { HttpError } from "./http";
export const analysisSchema = z.object({
  method: z.string(),
  pitch: z
    .array(
      z.object({
        timeSec: z.number().nonnegative(),
        hz: z.number().positive().nullable(),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(10000),
  voicedRatio: z.number().min(0).max(1),
  medianHz: z.number().positive().nullable(),
  bpm: z.number().positive().nullable(),
  tempoConfidence: z.number(),
  warnings: z.array(z.string()),
  note: z.string(),
});
export type MelodyAnalysis = z.infer<typeof analysisSchema>;
export const preparedSchema = z.object({
  path: z.string(),
  durationSec: z.number().positive().max(180),
  sampleRate: z.number().int(),
  channels: z.number().int(),
  processing: z.object({
    trimStartSec: z.number(),
    trimEndSec: z.number(),
    gainDb: z.number(),
  }),
  analysis: analysisSchema,
});
export const editSchema = z
  .object({
    baseVersionId: z.string().uuid(),
    sourceType: z.enum(["version", "hum"]),
    sourceId: z.string().uuid(),
    startSec: z.number().finite().nonnegative(),
    endSec: z.number().finite().positive(),
    sourceStartSec: z.number().finite().nonnegative().default(0),
    crossfadeMs: z.number().finite().min(0).max(1000).default(30),
    matchLevel: z.boolean().default(false),
  })
  .refine((v) => v.endSec - v.startSec >= 0.05, {
    message: "替换区间至少 50 毫秒",
  });
export const replacedSchema = z.object({
  path: z.string(),
  durationSec: z.number().positive(),
  metadata: z.object({
    startSec: z.number(),
    endSec: z.number(),
    sourceStartSec: z.number(),
    crossfadeMs: z.number(),
    gain: z.number(),
    outsideRegionUnchanged: z.literal(true),
    peak: z.number(),
    sampleRate: z.number(),
    note: z.string(),
  }),
});
function serviceUrl(endpoint: string) {
  const url = new URL(config.audioServiceUrl);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new HttpError(503, "音频服务必须运行在本机");
  url.pathname = endpoint;
  return url;
}
export async function audioServiceOnline() {
  try {
    const response = await fetch(serviceUrl("/health"), {
      signal: AbortSignal.timeout(1500),
      cache: "no-store",
    });
    return response.ok && (await response.json()).status === "ok";
  } catch {
    return false;
  }
}
export async function callAudioService<S extends z.ZodType>(
  endpoint: string,
  input: unknown,
  schema: S,
): Promise<z.infer<S>> {
  let response: Response;
  try {
    response = await fetch(serviceUrl(endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120000),
      redirect: "error",
    });
  } catch {
    throw new HttpError(
      503,
      "本地音频服务未连接或处理超时。请启动音频服务后重试，录音预览会保留。",
    );
  }
  if (!response.ok) {
    let detail = "本地音频处理失败，请检查素材时长和替换区间";
    try {
      const body = await response.json();
      if (typeof body.detail === "string") detail = body.detail.slice(0, 300);
    } catch {}
    throw new HttpError(response.status === 409 ? 409 : 422, detail);
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new HttpError(
      502,
      "音频服务返回格式异常，请确认 Web 与音频服务版本一致",
    );
  }
}
