import { z } from "zod";
import { config } from "./config";
import { buildPrompt, type GenerationRequest } from "./domain";
export class ProviderError extends Error {
  constructor(
    message: string,
    public uncertain: boolean,
  ) {
    super(message);
  }
}
const responseSchema = z.object({
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullish() }) }))
    .optional(),
  data: z
    .array(
      z.object({
        url: z.string().optional(),
        download_url: z.string().optional(),
        audio_url: z.string().optional(),
      }),
    )
    .optional(),
});
export function extractLinks(value: unknown) {
  const parsed = responseSchema.parse(value);
  const links: string[] = [];
  const add = (url?: string) => {
    if (url && /^https:\/\//i.test(url) && !links.includes(url))
      links.push(url);
  };
  for (const item of parsed.data ?? [])
    for (const field of [item.url, item.download_url, item.audio_url])
      add(field);
  if (!links.length)
    for (const c of parsed.choices ?? []) {
      for (const match of (c.message.content || "").matchAll(
        /https:\/\/[^\s<>"')\]]+/g,
      ))
        add(match[0].replace(/[.,;，。；]+$/, ""));
    }
  if (!links.length || links.length > 4)
    throw new Error("接口未返回可识别的音频链接，请核对使用记录");
  return links;
}
export async function generate(request: GenerationRequest) {
  if (!config.apiKey) throw new ProviderError("未配置 FLUXPORT_API_KEY", false);
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: request.model,
        stream: false,
        messages: [{ role: "user", content: buildPrompt(request) }],
      }),
      signal: AbortSignal.timeout(request.model === "suno" ? 600000 : 660000),
      redirect: "error",
    });
  } catch {
    throw new ProviderError(
      "生成连接中断或超时，提交结果未知。请先核对 FluxPort 使用记录，系统不会自动重新生成。",
      true,
    );
  }
  if (!response.ok) {
    // Never return upstream bodies: they can echo credentials or signed URLs.
    throw new ProviderError(
      `音乐接口返回 HTTP ${response.status}。请核对余额、限流和平台使用记录。`,
      response.status >= 500 || response.status === 408,
    );
  }
  try {
    const body = await response.text();
    if (body.length > 1024 * 1024) throw new Error("响应过大");
    return {
      urls: extractLinks(JSON.parse(body)),
      requestId: response.headers.get("x-request-id"),
    };
  } catch {
    throw new ProviderError(
      "接口返回成功，但未能解析音频结果。请核对平台记录；不会自动重新生成。",
      true,
    );
  }
}
