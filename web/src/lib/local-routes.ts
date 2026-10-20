import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "./db";
import { config } from "./config";
import { assetPath, inspectAudio, saveAudio } from "./audio";
import { HttpError, jsonBody } from "./http";
import { serveAudio } from "./serve-audio";
import {
  audioServiceOnline,
  callAudioService,
  preparedSchema,
  replacedSchema,
  editSchema,
} from "./local-audio";
const uuid = z.string().uuid();
const humTypes: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  flac: "audio/flac",
  webm: "audio/webm",
  ogg: "audio/ogg",
};
async function activeProject(id: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id } });
  if (project.archivedAt) throw new HttpError(409, "请先恢复归档项目");
  return project;
}
async function removeUnpublished(relative: string) {
  await unlink(path.join(config.dataRoot, relative)).catch(() => {});
}
async function prepareHum(
  input: {
    projectId: string;
    label: string;
    originalPath: string;
    originalSha256: string;
    originalMimeType: string;
    originalDurationSec: number;
  },
  trimSilence: boolean,
  normalize: boolean,
) {
  const dst = `audio/${randomUUID()}.wav`;
  try {
    const processed = await callAudioService(
      "/prepare",
      { src: input.originalPath, dst, trim_silence: trimSilence, normalize },
      preparedSchema,
    );
    if (processed.path !== dst)
      throw new HttpError(502, "音频服务输出路径不一致");
    const audio = await inspectAudio(await assetPath(dst));
    return await db.$transaction(async (tx) => {
      const record = await tx.humAsset.create({
        data: {
          ...input,
          ...audio,
          assetPath: dst,
          analysisJson: JSON.stringify(processed.analysis),
          processingJson: JSON.stringify({
            trimSilence,
            normalize,
            ...processed.processing,
          }),
        },
      });
      await tx.project.update({
        where: { id: input.projectId },
        data: { updatedAt: new Date() },
      });
      return record;
    });
  } catch (error) {
    await removeUnpublished(dst);
    throw error;
  }
}
export async function localGet(request: NextRequest, parts: string[]) {
  if (parts.join("/") === "audio-service")
    return NextResponse.json({ online: await audioServiceOnline() });
  if (parts[0] === "hums" && parts[2] === "audio" && parts.length === 3) {
    const hum = await db.humAsset.findUniqueOrThrow({
      where: { id: uuid.parse(parts[1]) },
    });
    const original = request.nextUrl.searchParams.get("original") === "1";
    return serveAudio(request, {
      id: hum.id,
      label: hum.label + (original ? "-原始" : "-标准化"),
      assetPath: original ? hum.originalPath : hum.assetPath,
      mimeType: original ? hum.originalMimeType : "audio/wav",
    });
  }
  return undefined;
}
export async function localPost(request: NextRequest, parts: string[]) {
  if (parts[0] === "projects" && parts.length === 3 && parts[2] === "hums") {
    const projectId = uuid.parse(parts[1]);
    await activeProject(projectId);
    if (!(await audioServiceOnline()))
      throw new HttpError(
        503,
        "本地音频服务未连接，请启动服务后再保存哼唱；录音预览会保留。",
      );
    if (Number(request.headers.get("content-length")) > 51 * 1024 * 1024)
      throw new HttpError(413, "哼唱文件不能超过 50 MB");
    const form = await request.formData(),
      file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 50 * 1024 * 1024)
      throw new HttpError(400, "请选择 50 MB 以内、最长 180 秒的哼唱音频");
    const ext = file.name.split(".").at(-1)?.toLowerCase();
    if (!ext || !humTypes[ext])
      throw new HttpError(400, "支持 wav / mp3 / m4a / flac / webm / ogg");
    let original;
    try {
      original = await saveAudio(Buffer.from(await file.arrayBuffer()), ext);
    } catch {
      throw new HttpError(422, "无法读取哼唱音频，请检查格式或重新录音");
    }
    try {
      if (original.durationSec > 180)
        throw new HttpError(422, "哼唱最长支持 180 秒，请裁短后再上传");
      const record = await prepareHum(
        {
          projectId,
          label: file.name.slice(0, 100),
          originalPath: original.assetPath,
          originalSha256: original.sha256,
          originalMimeType: humTypes[ext],
          originalDurationSec: original.durationSec,
        },
        form.get("trimSilence") !== "false",
        form.get("normalize") !== "false",
      );
      return NextResponse.json(record, { status: 201 });
    } catch (e) {
      await removeUnpublished(original.assetPath);
      throw e;
    }
  }
  if (parts[0] === "hums" && parts[2] === "reprocess" && parts.length === 3) {
    const hum = await db.humAsset.findUniqueOrThrow({
      where: { id: uuid.parse(parts[1]) },
    });
    await activeProject(hum.projectId);
    const body = z
      .object({ trimSilence: z.boolean(), normalize: z.boolean() })
      .parse(await jsonBody(request));
    return NextResponse.json(
      await prepareHum(
        {
          projectId: hum.projectId,
          label: hum.label,
          originalPath: hum.originalPath,
          originalSha256: hum.originalSha256,
          originalMimeType: hum.originalMimeType,
          originalDurationSec: hum.originalDurationSec,
        },
        body.trimSilence,
        body.normalize,
      ),
      { status: 201 },
    );
  }
  if (parts[0] === "projects" && parts[2] === "edits" && parts.length === 3) {
    const projectId = uuid.parse(parts[1]);
    await activeProject(projectId);
    const input = editSchema.parse(await jsonBody(request));
    const base = await db.version.findFirst({
      where: { id: input.baseVersionId, projectId },
    });
    const source =
      input.sourceType === "version"
        ? await db.version.findFirst({
            where: { id: input.sourceId, projectId },
          })
        : await db.humAsset.findFirst({
            where: { id: input.sourceId, projectId },
          });
    if (!base || !source)
      throw new HttpError(400, "原曲和替换素材必须属于当前项目");
    if (base.durationSec > 600 || source.durationSec > 600)
      throw new HttpError(422, "本地替换支持最长 10 分钟的音频");
    if (
      input.endSec > base.durationSec + 0.0001 ||
      input.sourceStartSec + input.endSec - input.startSec >
        source.durationSec + 0.0001
    )
      throw new HttpError(
        400,
        "选区越界或替换素材长度不足；不会自动拉伸或循环",
      );
    const dst = `audio/${randomUUID()}.wav`;
    try {
      const result = await callAudioService(
        "/replace",
        {
          base: base.assetPath,
          replacement: source.assetPath,
          dst,
          start_sec: input.startSec,
          end_sec: input.endSec,
          source_start_sec: input.sourceStartSec,
          crossfade_ms: input.crossfadeMs,
          match_level: input.matchLevel,
        },
        replacedSchema,
      );
      if (result.path !== dst)
        throw new HttpError(502, "音频服务输出路径不一致");
      const audio = await inspectAudio(await assetPath(dst));
      const record = await db.$transaction(async (tx) => {
        const version = await tx.version.create({
          data: {
            projectId,
            parentVersionId: base.id,
            label: `本地替换 ${input.startSec.toFixed(2)}–${input.endSec.toFixed(2)} 秒`,
            sourceType: "local_edit",
            implementation: "local",
            provider: "local",
            model: "equal-length-splice",
            paramsSnapshot: JSON.stringify({ ...input, ...result.metadata }),
            assetPath: dst,
            mimeType: "audio/wav",
            ...audio,
          },
        });
        await tx.project.update({
          where: { id: projectId },
          data: { updatedAt: new Date() },
        });
        return version;
      });
      return NextResponse.json(record, { status: 201 });
    } catch (e) {
      await removeUnpublished(dst);
      throw e;
    }
  }
  return undefined;
}
