import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client";
import { generationSnapshotSchema } from "./domain";

// Only portable creative fields belong in Git. No credentials, local asset
// references, provider responses, or generation jobs are part of this format.
export const projectPresetSchema = z
  .object({
    schemaVersion: z.literal(1),
    key: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(100),
    name: z.string().trim().min(1).max(100),
    lyricsDraft: z.string().max(8000),
    promptDraft: generationSnapshotSchema
      .omit({
        lyrics: true,
        sourceJobId: true,
        parentVersionId: true,
      })
      .strict(),
  })
  .strict();
export type ProjectPreset = z.infer<typeof projectPresetSchema>;

export async function readProjectPresets(directory: string) {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".json"))
    .sort();
  if (!files.length) throw new Error("预设目录中没有 JSON 文件");
  const presets = await Promise.all(
    files.map(async (file) => {
      try {
        return projectPresetSchema.parse(
          JSON.parse(await readFile(path.join(directory, file), "utf8")),
        );
      } catch {
        throw new Error(`预设 ${file} 格式无效，请检查字段和 schemaVersion`);
      }
    }),
  );
  if (new Set(presets.map((preset) => preset.key)).size !== presets.length)
    throw new Error("预设 key 重复");
  return presets;
}

function importedProjectId(preset: ProjectPreset) {
  // UUID v5: the normalized contents identify a revision. Importing it again
  // skips the existing copy, including any subsequent local edits or archive.
  const namespace = Buffer.from("7d151d6b7eab4b0ba371f5bb5e141c2b", "hex");
  const bytes = createHash("sha1")
    .update(namespace)
    .update(JSON.stringify(preset))
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function importProjectPresets(
  db: PrismaClient,
  input: ProjectPreset[],
) {
  const presets = z.array(projectPresetSchema).min(1).parse(input);
  if (new Set(presets.map((preset) => preset.key)).size !== presets.length)
    throw new Error("预设 key 重复");
  return db.$transaction(async (tx) => {
    const results = [];
    for (const preset of presets) {
      const id = importedProjectId(preset);
      const existing = await tx.project.findUnique({ where: { id } });
      if (existing) {
        results.push({ name: preset.name, id, imported: false });
        continue;
      }
      await tx.project.create({
        data: {
          id,
          name: preset.name,
          lyricsDraft: preset.lyricsDraft,
          promptDraft: JSON.stringify(preset.promptDraft),
        },
      });
      results.push({ name: preset.name, id, imported: true });
    }
    return results;
  });
}
