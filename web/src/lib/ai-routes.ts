import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stat } from "node:fs/promises";
import { db } from "./db";
import { HttpError, jsonBody } from "./http";
import { assetPath } from "./audio";
import { aiRequestSchema } from "./ai-domain";
import {
  publicSunoSettings,
  sunoSettings,
  saveSunoKey,
  keySchema,
} from "./ai-settings";
import { checkSunoKey } from "./suno-provider";
import { audioServiceOnline } from "./local-audio";
export async function aiGet(parts: string[]) {
  if (parts.join("/") === "ai/config")
    return NextResponse.json(publicSunoSettings(), {
      headers: { "Cache-Control": "no-store" },
    });
}
export async function aiPost(request: NextRequest, parts: string[]) {
  if (parts.join("/") === "ai/config") {
    const input = z
      .object({
        action: z.enum(["save", "verify", "clear"]),
        apiKey: keySchema.optional(),
      })
      .parse(await jsonBody(request));
    if (
      (input.action === "clear" ||
        (input.apiKey && input.apiKey !== sunoSettings().key)) &&
      (await db.generationJob.count({
        where: {
          provider: "suno-api",
          status: {
            in: ["queued", "uploading", "submitting", "running", "downloading"],
          },
        },
      }))
    )
      throw new HttpError(
        409,
        "还有 AI 任务正在处理，请完成或取消排队任务后再更换 Key",
      );
    if (input.action === "clear") {
      saveSunoKey("", null, true);
      return NextResponse.json(publicSunoSettings());
    }
    const key = input.apiKey || sunoSettings().key;
    if (!key) throw new HttpError(400, "请填写 suno-api.io 的 API Key");
    if (input.action === "save") {
      saveSunoKey(key);
      return NextResponse.json(publicSunoSettings());
    }
    try {
      const balance = await checkSunoKey(key);
      saveSunoKey(key, new Date().toISOString());
      return NextResponse.json(
        { ...publicSunoSettings(), balance },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (e) {
      throw new HttpError(
        422,
        e instanceof Error ? e.message : "服务连接验证失败",
      );
    }
  }
  if (parts[0] === "projects" && parts[2] === "ai-jobs" && parts.length === 3) {
    const projectId = z.string().uuid().parse(parts[1]),
      raw = await jsonBody(request);
    const clientRequestId = z.string().uuid().parse(raw.clientRequestId),
      input = aiRequestSchema.parse(raw);
    const existing = await db.generationJob.findUnique({
      where: { id: clientRequestId },
    });
    if (existing) {
      if (
        existing.projectId !== projectId ||
        existing.provider !== "suno-api" ||
        existing.requestParams !== JSON.stringify(input)
      )
        throw new HttpError(409, "重复请求参数不一致");
      return NextResponse.json(existing, { status: 202 });
    }
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    if (project.archivedAt) throw new HttpError(409, "请先恢复归档项目");
    if (!sunoSettings().configured)
      throw new HttpError(
        400,
        "请先在下方 AI 服务配置中填写 suno-api.io 的 API Key",
      );
    let source;
    if (input.kind === "hum_cover")
      source = await db.humAsset.findFirst({
        where: { id: input.humId, projectId },
      });
    else {
      source = await db.version.findFirst({
        where: { id: input.baseVersionId, projectId },
      });
      if (
        source &&
        (source.durationSec > 600 || input.endSec > source.durationSec)
      )
        throw new HttpError(400, "替换区间超出原曲，或原曲长于 10 分钟");
      if (!(await audioServiceOnline()))
        throw new HttpError(
          503,
          "请先启动本地音频服务，AI 重写结果需要在本地重建选区",
        );
    }
    if (!source) throw new HttpError(400, "源音频不存在或不属于当前项目");
    if ((await stat(await assetPath(source.assetPath))).size > 50 * 1024 * 1024)
      throw new HttpError(
        400,
        "AI 源音频不能超过 50 MB，请先导入更小的 MP3 素材",
      );
    const job = await db.generationJob.upsert({
      where: { id: clientRequestId },
      create: {
        id: clientRequestId,
        projectId,
        provider: "suno-api",
        model: input.model,
        requestParams: JSON.stringify(input),
        parentVersionId:
          input.kind === "section_rewrite" ? input.baseVersionId : null,
      },
      update: {},
    });
    if (
      job.projectId !== projectId ||
      job.requestParams !== JSON.stringify(input)
    )
      throw new HttpError(409, "重复请求参数不一致");
    await db.project.update({
      where: { id: projectId },
      data: { updatedAt: new Date() },
    });
    return NextResponse.json(job, { status: 202 });
  }
  if (
    parts[0] === "jobs" &&
    parts[2] === "resume-query" &&
    parts.length === 3
  ) {
    const id = z.string().uuid().parse(parts[1]);
    const changed = await db.generationJob.updateMany({
      where: {
        id,
        provider: "suno-api",
        status: "poll_failed",
        providerTaskId: { not: null },
      },
      data: {
        status: "running",
        pollFailures: 0,
        nextPollAt: null,
        pollStartedAt: new Date(),
        errorMessage: null,
        finishedAt: null,
      },
    });
    if (!changed.count)
      throw new HttpError(409, "仅已保存歌曲 ID 的查询暂停任务可继续查询");
    return NextResponse.json({ ok: true });
  }
}
