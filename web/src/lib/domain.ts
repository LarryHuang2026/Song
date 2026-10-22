import { z } from "zod";
import { redactSecrets } from "./secrets";
import { vocalConflicts, vocalInstruction } from "./vocal";
export const models = [
  "suno-v6",
  "suno-v6-wild",
  "suno-v6-mini",
  "suno-v5.5",
  "suno-v5",
  "Lyria-3.5音频音乐",
  "Lyria-3pro音频音乐",
  "suno",
] as const;
export const isVersionedSuno = (model: string) => model.startsWith("suno-v");
export const promptLimit = (model: string) =>
  isVersionedSuno(model) ? 3000 : 10000;
export function modelLabel(model: string) {
  const labels: Record<string, string> = {
    "suno-v6": "Suno V6 · 推荐（标准版）",
    "suno-v6-wild": "Suno V6 Wild · 实验探索",
    "suno-v6-mini": "Suno V6 Mini · 快速试稿",
    "suno-v5.5": "Suno V5.5",
    "suno-v5": "Suno V5",
    suno: "Suno · 旧入口（权限以平台为准）",
  };
  return labels[model] || model.replace("音频音乐", "");
}
export const generationSnapshotSchema = z.object({
  provider: z.enum(["fluxport", "mock"]).default("mock"),
  model: z.enum(models).default("suno-v6"),
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
});
export const generationSchema = generationSnapshotSchema.superRefine(
  (v, ctx) => {
    for (const conflict of vocalConflicts(v))
      ctx.addIssue({
        code: "custom",
        path: [conflict.field],
        message: `${conflict.label}中的「${conflict.terms.join("、")}」与演唱选项冲突，请先清除冲突要求`,
      });
    const limit = promptLimit(v.model);
    if (buildPrompt(v).length > limit)
      ctx.addIssue({
        code: "custom",
        message: `当前模型合并后的提示词不能超过 ${limit} 字符`,
      });
  },
);
export type GenerationRequest = z.infer<typeof generationSchema>;
export function buildPrompt(
  v: Omit<GenerationRequest, "provider" | "model">,
): string {
  const voice = vocalInstruction(v);
  return [
    voice && `【优先演唱设定】${voice}`,
    v.description,
    `目标时长：约 ${v.duration} 秒。请创作有完整结构的音乐。`,
    v.style && `风格：${v.style}`,
    v.mood && `情绪：${v.mood}`,
    v.instruments && `乐器：${v.instruments}`,
    !v.instrumental && v.lyrics && `歌词（请按词演唱）：\n${v.lyrics}`,
    voice && `【最终演唱要求】${voice}`,
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
