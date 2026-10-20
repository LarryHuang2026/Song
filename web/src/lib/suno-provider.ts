import { readFile } from "node:fs/promises";
import { z } from "zod";
import { assetPath } from "./audio";
import { sunoOrigin, sunoSettings } from "./ai-settings";
import { registerSecret } from "./secrets";
import { ProviderError } from "./provider";
import type { AiRequest } from "./ai-domain";
const clip = z.object({
  song_id: z
    .string()
    .min(1)
    .max(200)
    .refine((id) => !id.startsWith("pending:")),
  status: z.string(),
  audio_url: z.string().nullable().optional(),
});
const submitted = z.object({
  code: z.literal(200),
  data: z.object({ clips: z.array(clip).min(1).max(4) }),
});
const queryResponse = z.array(clip).max(4);
export async function sunoRequest(
  endpoint: string,
  body?: unknown,
  paid = false,
  overrideKey?: string,
) {
  const key = overrideKey ?? sunoSettings().key;
  if (!key)
    throw new ProviderError(
      "请在 AI 服务配置中填写 suno-api.io 的 API Key",
      false,
    );
  registerSecret(key);
  let response: Response;
  try {
    response = await fetch(sunoOrigin() + endpoint, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body && !(body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
      },
      ...(body
        ? { body: body instanceof FormData ? body : JSON.stringify(body) }
        : {}),
      redirect: "error",
      signal: AbortSignal.timeout(paid ? 330000 : 90000),
    });
  } catch {
    throw new ProviderError(
      paid
        ? "AI 生成连接中断，提交结果未知；请核对服务商记录，禁止直接重提。"
        : "AI 服务连接失败，请检查网络后重试查询或上传",
      paid,
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderError(
      `AI 服务返回 HTTP ${response.status}；请检查 Key、余额、模型权限及服务商记录。`,
      paid && (response.status >= 500 || response.status === 408),
    );
  }
  try {
    const text = await response.text();
    if (text.length > 1024 * 1024) throw new Error();
    return JSON.parse(text);
  } catch {
    throw new ProviderError("AI 服务响应无法解析，请核对任务记录", paid);
  }
}
export async function checkSunoKey(key?: string) {
  const result = await sunoRequest("/api/user/balance", undefined, false, key);
  const data = z
    .object({
      success: z.literal(true),
      data: z.object({
        balance: z.object({ effective_amount: z.number().nonnegative() }),
      }),
    })
    .safeParse(result);
  if (!data.success)
    throw new ProviderError("服务没有返回有效余额信息，请核对 Key 权限", false);
  return data.data.data.balance.effective_amount;
}
export async function uploadSunoSource(relative: string, model: string) {
  const file = await assetPath(relative),
    bytes = await readFile(file);
  if (bytes.length > 50 * 1024 * 1024)
    throw new ProviderError(
      "AI 源音频最大支持 50 MB，请先导出更短的素材",
      false,
    );
  const ext = relative.split(".").at(-1),
    form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)]), `source.${ext}`);
  form.set("file_name", `source.${ext}`);
  form.set("upload_type", "file_upload");
  form.set("model", model);
  const result = z
    .object({
      clip_id: z.string().min(1).max(200),
      status: z.enum(["complete", "completed"]),
    })
    .safeParse(await sunoRequest("/api/music/upload-source", form));
  if (!result.success || result.data.clip_id.startsWith("pending:"))
    throw new ProviderError(
      "音频上传尚未完成或未获得真实 clip ID；本次未提交生成",
      false,
    );
  return result.data.clip_id;
}
export async function submitSuno(request: AiRequest, sourceId: string) {
  const endpoint =
    request.kind === "hum_cover"
      ? "/api/music/generate-from-source"
      : "/api/music/replace-section";
  const body =
    request.kind === "hum_cover"
      ? {
          model: request.model,
          sourceClipId: sourceId,
          title: request.title,
          style: request.style,
          customMode: !!request.lyrics.trim(),
          prompt: request.lyrics.trim() || request.description,
          instrumental: request.instrumental,
          audio_weight: request.audioWeight,
          waitAudio: false,
        }
      : {
          model: request.model,
          audioId: sourceId,
          startSeconds: request.startSec,
          endSeconds: request.endSec,
          contextLyrics: request.contextLyrics,
          infillLyrics: request.infillLyrics,
          contextWindowLyrics:
            request.contextWindowLyrics || request.contextLyrics,
          style: request.style,
          title: request.title,
        };
  const result = submitted.safeParse(await sunoRequest(endpoint, body, true));
  if (!result.success)
    throw new ProviderError(
      "AI 请求已返回，但未获得可追踪的真实歌曲 ID，请先核对服务商记录",
      true,
    );
  return result.data.data.clips;
}
export async function pollSuno(ids: string[], model: string) {
  const result = queryResponse.safeParse(
    await sunoRequest("/api/music/query", { model, song_ids: ids.join(",") }),
  );
  if (!result.success)
    throw new ProviderError(
      "AI 查询响应格式异常，任务 ID 已保留，可以稍后继续查询",
      false,
    );
  if (result.data.some((item) => !ids.includes(item.song_id)))
    throw new ProviderError("AI 查询返回了不属于当前任务的歌曲", false);
  return result.data;
}
