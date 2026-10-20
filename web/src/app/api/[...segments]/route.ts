import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { generationSchema, activeStates, models } from "@/lib/domain";
import { saveAudio } from "@/lib/audio";
import { serveAudio } from "@/lib/serve-audio";
import { localGet, localPost } from "@/lib/local-routes";
import { aiGet, aiPost } from "@/lib/ai-routes";
import { guard, HttpError, jsonBody, errorResponse } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ segments: string[] }> };
const uuid = z.string().uuid();
const draftSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  lyricsDraft: z.string().max(8000).optional(),
  promptDraft: z
    .object({
      provider: z.enum(["mock", "fluxport"]),
      model: z.enum(models),
      description: z.string().max(2000),
      style: z.string().max(200),
      mood: z.string().max(200),
      vocal: z.string().max(100),
      instruments: z.string().max(200),
      duration: z.number().int().min(15).max(300),
      instrumental: z.boolean(),
    })
    .optional(),
  archived: z.boolean().optional(),
  selectedVersionId: uuid.optional(),
});
async function get(request: NextRequest, parts: string[]) {
  const ai = await aiGet(parts);
  if (ai) return ai;
  const local = await localGet(request, parts);
  if (local) return local;
  if (parts.join("/") === "state") {
    const archived = request.nextUrl.searchParams.get("archived") === "true";
    const [projects, worker] = await Promise.all([
      db.project.findMany({
        where: { archivedAt: archived ? { not: null } : null },
        orderBy: { updatedAt: "desc" },
        include: {
          versions: { orderBy: { createdAt: "desc" } },
          hums: { orderBy: { createdAt: "desc" } },
          jobs: {
            orderBy: { createdAt: "desc" },
            take: 50,
            include: {
              outputs: {
                orderBy: { index: "asc" },
                select: {
                  id: true,
                  index: true,
                  status: true,
                  receivedBytes: true,
                  totalBytes: true,
                  errorMessage: true,
                },
              },
            },
          },
        },
      }),
      db.workerState.findUnique({ where: { id: "main" } }),
    ]);
    return NextResponse.json(
      {
        projects,
        configured: !!config.apiKey,
        workerOnline:
          !!worker && Date.now() - worker.heartbeatAt.getTime() < 20000,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (parts[0] === "audio" && parts.length === 2) {
    const version = await db.version.findUnique({
      where: { id: uuid.parse(parts[1]) },
    });
    if (!version) throw new HttpError(404, "音频不存在");
    return serveAudio(request, version);
  }
  throw new HttpError(404, "接口不存在");
}
async function post(request: NextRequest, parts: string[]) {
  const ai = await aiPost(request, parts);
  if (ai) return ai;
  const local = await localPost(request, parts);
  if (local) return local;
  if (parts.join("/") === "projects") {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(await jsonBody(request));
    return NextResponse.json(await db.project.create({ data: { name } }), {
      status: 201,
    });
  }
  if (parts[0] === "projects" && parts.length === 3) {
    const projectId = uuid.parse(parts[1]);
    const project = await db.project.findUniqueOrThrow({
      where: { id: projectId },
    });
    if (project.archivedAt) throw new HttpError(409, "请先恢复归档项目");
    if (parts[2] === "jobs") {
      const input = await jsonBody(request);
      const clientRequestId = uuid.parse(input.clientRequestId);
      const parsed = generationSchema.parse(input);
      if (parsed.provider === "fluxport" && !config.apiKey)
        throw new HttpError(400, "请先配置 FLUXPORT_API_KEY");
      if (
        parsed.sourceJobId &&
        !(await db.generationJob.findFirst({
          where: { id: parsed.sourceJobId, projectId },
        }))
      )
        throw new HttpError(400, "来源任务不属于当前项目");
      if (
        parsed.parentVersionId &&
        !(await db.version.findFirst({
          where: { id: parsed.parentVersionId, projectId },
        }))
      )
        throw new HttpError(400, "父版本不属于当前项目");
      const job = await db.$transaction(async (tx) => {
        const existing = await tx.generationJob.findUnique({
          where: { id: clientRequestId },
        });
        if (existing) {
          if (
            existing.projectId !== projectId ||
            existing.requestParams !== JSON.stringify(parsed)
          )
            throw new HttpError(409, "重复请求参数不一致");
          return existing;
        }
        const record = await tx.generationJob.create({
          data: {
            id: clientRequestId,
            projectId,
            provider: parsed.provider,
            model: parsed.model,
            requestParams: JSON.stringify(parsed),
            sourceJobId: parsed.sourceJobId,
            parentVersionId: parsed.parentVersionId,
          },
        });
        await tx.project.update({
          where: { id: projectId },
          data: { updatedAt: new Date() },
        });
        return record;
      });
      return NextResponse.json(job, { status: 202 });
    }
    if (parts[2] === "import") {
      if (Number(request.headers.get("content-length")) > 51 * 1024 * 1024)
        throw new HttpError(413, "上传不能超过 50 MB");
      const form = await request.formData();
      const file = form.get("file");
      if (
        !(file instanceof File) ||
        file.size === 0 ||
        file.size > 50 * 1024 * 1024
      )
        throw new HttpError(400, "请选择 50 MB 以内的音频");
      const ext = file.name.split(".").at(-1)?.toLowerCase();
      const types: Record<string, string> = {
        mp3: "audio/mpeg",
        wav: "audio/wav",
        m4a: "audio/mp4",
        flac: "audio/flac",
      };
      if (!ext || !types[ext])
        throw new HttpError(400, "支持 mp3 / wav / m4a / flac");
      let audio;
      try {
        audio = await saveAudio(Buffer.from(await file.arrayBuffer()), ext);
      } catch {
        throw new HttpError(422, "无法读取音频，请检查文件格式和 FFmpeg 安装");
      }
      const version = await db.$transaction(async (tx) => {
        const record = await tx.version.create({
          data: {
            projectId,
            label: file.name.slice(0, 100),
            sourceType: "import",
            implementation: "local",
            provider: "local",
            model: "original",
            paramsSnapshot: "{}",
            mimeType: types[ext],
            ...audio,
          },
        });
        await tx.project.update({
          where: { id: projectId },
          data: { updatedAt: new Date() },
        });
        return record;
      });
      return NextResponse.json(version, { status: 201 });
    }
  }
  if (parts[0] === "jobs" && parts.length === 3) {
    const id = uuid.parse(parts[1]);
    if (parts[2] === "retry-download") {
      const updated = await db.generationJob.updateMany({
        where: { id, status: "download_failed" },
        data: { status: "downloading", errorMessage: null, finishedAt: null },
      });
      if (!updated.count)
        throw new HttpError(409, "仅下载失败的任务可以重试下载");
    } else if (parts[2] === "cancel") {
      if (
        !(
          await db.generationJob.updateMany({
            where: { id, status: "queued" },
            data: { status: "cancelled", finishedAt: new Date() },
          })
        ).count
      )
        throw new HttpError(409, "仅排队中的任务可取消；已提交的生成无法取消");
    } else throw new HttpError(404, "接口不存在");
    return NextResponse.json({ ok: true });
  }
  throw new HttpError(404, "接口不存在");
}
async function patch(request: NextRequest, parts: string[]) {
  if (parts[0] !== "projects" || parts.length !== 2)
    throw new HttpError(404, "接口不存在");
  const id = uuid.parse(parts[1]),
    body = draftSchema.parse(await jsonBody(request));
  if (
    body.selectedVersionId &&
    !(await db.version.findFirst({
      where: { id: body.selectedVersionId, projectId: id },
    }))
  )
    throw new HttpError(400, "版本不属于当前项目");
  if (
    body.archived &&
    (await db.generationJob.count({
      where: { projectId: id, status: { in: activeStates } },
    }))
  )
    throw new HttpError(409, "项目还有任务正在处理，请完成后再归档");
  const { archived, promptDraft, ...rest } = body;
  return NextResponse.json(
    await db.project.update({
      where: { id },
      data: {
        ...rest,
        ...(promptDraft ? { promptDraft: JSON.stringify(promptDraft) } : {}),
        ...(archived === undefined
          ? {}
          : { archivedAt: archived ? new Date() : null }),
      },
    }),
  );
}
async function handle(request: NextRequest, context: Context) {
  try {
    guard(request);
    const { segments } = await context.params;
    if (request.method === "GET") return await get(request, segments);
    if (request.method === "POST") return await post(request, segments);
    return await patch(request, segments);
  } catch (e) {
    return errorResponse(e);
  }
}
export { handle as GET, handle as POST, handle as PATCH };
