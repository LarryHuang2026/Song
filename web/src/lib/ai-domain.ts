import { z } from "zod";
const common = {
  model: z.enum(["suno-v6", "suno-v6-wild", "suno-v6-mini"]).default("suno-v6"),
  title: z.string().trim().min(1).max(100),
  style: z.string().trim().min(1).max(1000),
};
export const aiRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("hum_cover"),
    humId: z.string().uuid(),
    lyrics: z.string().max(8000).default(""),
    description: z.string().trim().min(1).max(2000),
    instrumental: z.boolean().default(false),
    audioWeight: z.number().min(0).max(1).default(0.7),
  }),
  z
    .object({
      ...common,
      kind: z.literal("section_rewrite"),
      baseVersionId: z.string().uuid(),
      startSec: z.number().finite().nonnegative(),
      endSec: z.number().finite().positive(),
      contextLyrics: z
        .string()
        .trim()
        .min(1, "请填写整首歌词，作为段落重写上下文")
        .max(8000),
      infillLyrics: z.string().max(4000),
      contextWindowLyrics: z.string().max(4000).default(""),
      crossfadeMs: z.number().min(0).max(1000).default(30),
    })
    .refine((v) => v.endSec - v.startSec >= 2, {
      message: "AI 段落重写至少需要 2 秒",
    }),
]);
export type AiRequest = z.infer<typeof aiRequestSchema>;
export type AiJob = {
  id: string;
  projectId: string;
  provider: string;
  model: string;
  status: string;
  requestParams: string;
  errorMessage: string | null;
  createdAt: string;
  outputs: {
    id: string;
    index: number;
    status: string;
    receivedBytes: number;
    totalBytes: number | null;
    errorMessage: string | null;
  }[];
};

// A draft may be incomplete or have an unfinished time range. Only real
// generation requests require a valid source and a complete selection.
export const aiDraftSchema = z
  .object({
    sourceId: z.union([z.string().uuid(), z.literal("")]),
    title: z.string().max(100),
    style: z.string().max(1000),
    model: common.model,
    lyrics: z.string().max(8000),
    description: z.string().max(2000),
    weight: z.number().finite().min(0).max(1),
    instrumental: z.boolean(),
    start: z.number().finite().min(-3600).max(3600),
    end: z.number().finite().min(-3600).max(3600),
    windowLyrics: z.string().max(4000),
    infillLyrics: z.string().max(4000),
    fade: z.number().finite().min(0).max(1000),
  })
  .strict();
export type AiDraft = z.infer<typeof aiDraftSchema>;
