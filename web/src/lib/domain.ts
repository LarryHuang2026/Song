import { z } from "zod";
import { redactSecrets } from "./secrets";
export const models = [
  "suno",
  "Lyria-3.5音频音乐",
  "Lyria-3pro音频音乐",
] as const;
export const generationSchema = z
  .object({
    provider: z.enum(["fluxport", "mock"]).default("mock"),
    model: z.enum(models).default("suno"),
    lyrics: z.string().max(8000).default(""),
    description: z.string().trim().min(1, "请填写创作描述").max(2000),
    style: z.string().max(200).default(""),
    mood: z.string().max(200).default(""),
    vocal: z.string().max(100).default(""),
    instruments: z.string().max(200).default(""),
    duration: z.number().int().min(15).max(300).default(180),
    instrumental: z.boolean().default(false),
    sourceJobId: z.string().uuid().optional(),
    parentVersionId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (buildPrompt(v).length > 10000)
      ctx.addIssue({
        code: "custom",
        message: "合并后的提示词不能超过 10000 字符",
      });
  });
export type GenerationRequest = z.infer<typeof generationSchema>;
export function buildPrompt(
  v: Omit<GenerationRequest, "provider" | "model">,
): string {
  return [
    v.description,
    `目标时长：约 ${v.duration} 秒。请创作有完整结构的音乐。`,
    v.style && `风格：${v.style}`,
    v.mood && `情绪：${v.mood}`,
    v.instrumental ? "纯音乐，不要人声。" : v.vocal && `演唱：${v.vocal}`,
    v.instruments && `乐器：${v.instruments}`,
    !v.instrumental && v.lyrics && `歌词（请按词演唱）：\n${v.lyrics}`,
  ]
    .filter(Boolean)
    .join("\n");
}
export function redact(value: unknown): string {
  let text = redactSecrets(String(value));
  // Keys and signed download links never belong in API responses or logs.
  if (process.env.FLUXPORT_API_KEY)
    text = text.split(process.env.FLUXPORT_API_KEY).join("[REDACTED]");
  return text
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[REDACTED]")
    .replace(
      /([?&](?:sig|signature|token|key|x-amz-[a-z-]+)=)[^&\s)"']+/gi,
      "$1[REDACTED]",
    )
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}
export const activeStates = [
  "queued",
  "uploading",
  "submitting",
  "running",
  "downloading",
];
