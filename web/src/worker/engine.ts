import { db } from "../lib/db";
import {
  generationSchema,
  generationSnapshotSchema,
  redact,
} from "../lib/domain";
import { generate, ProviderError } from "../lib/provider";
import { downloadAudio } from "../lib/download";
import { makeDemoWav, saveAudio } from "../lib/audio";
import { processAiJob } from "./ai-engine";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export async function recoverJobs() {
  await db.generationJob.updateMany({
    where: { provider: "suno-api", status: "uploading" },
    data: { status: "queued" },
  });
  await db.generationJob.updateMany({
    where: { status: "submitting" },
    data: {
      status: "unknown_submission",
      errorMessage:
        "worker 在生成过程中停止，提交结果未知。请核对平台记录；不会自动重提。",
      finishedAt: new Date(),
    },
  });
}
export async function processJob(id: string) {
  let job = await db.generationJob.findUniqueOrThrow({ where: { id } });
  if (job.provider === "suno-api") return processAiJob(id);
  let request;
  try {
    request = (
      job.status === "queued" ? generationSchema : generationSnapshotSchema
    ).parse(JSON.parse(job.requestParams));
  } catch {
    await db.generationJob.update({
      where: { id },
      data: {
        status: "failed",
        errorMessage:
          "任务参数无效或存在冲突，请载入参数修正后新建任务；未重新提交生成。",
        finishedAt: new Date(),
      },
    });
    return;
  }
  if (job.status === "queued") {
    const claimed = await db.generationJob.updateMany({
      where: { id, status: "queued" },
      data: { status: "submitting", submittedAt: new Date() },
    });
    if (!claimed.count) return;
    try {
      const result =
        request.provider === "mock"
          ? { urls: ["demo:0", "demo:1"], requestId: null }
          : await generate(request);
      await db.$transaction(async (tx) => {
        for (const [index, remoteUrl] of result.urls.entries())
          await tx.jobOutput.create({ data: { jobId: id, index, remoteUrl } });
        await tx.generationJob.update({
          where: { id },
          data: { status: "downloading", requestId: result.requestId },
        });
      });
    } catch (error) {
      await db.generationJob.update({
        where: { id },
        data: {
          status:
            error instanceof ProviderError && !error.uncertain
              ? "failed"
              : "unknown_submission",
          errorMessage: redact(error instanceof Error ? error.message : error),
          requestId: error instanceof ProviderError ? error.requestId : null,
          finishedAt: new Date(),
        },
      });
      return;
    }
  }
  job = await db.generationJob.findUniqueOrThrow({ where: { id } });
  if (job.status !== "downloading") return;
  const outputs = await db.jobOutput.findMany({
    where: { jobId: id, status: { not: "completed" } },
  });
  await Promise.all(
    outputs.map(async (output) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await db.jobOutput.update({
            where: { id: output.id },
            data: {
              status: "downloading",
              errorMessage: null,
              receivedBytes: 0,
            },
          });
          const audio =
            request.provider === "mock"
              ? {
                  ...(await saveAudio(makeDemoWav(output.index), "wav")),
                  mimeType: "audio/wav",
                }
              : await downloadAudio(
                  output.remoteUrl!,
                  async (receivedBytes, totalBytes) => {
                    await db.jobOutput.update({
                      where: { id: output.id },
                      data: { receivedBytes, totalBytes },
                    });
                  },
                );
          await db.$transaction(async (tx) => {
            await tx.version.create({
              data: {
                projectId: job.projectId,
                outputId: output.id,
                parentVersionId: job.parentVersionId,
                label: `候选 ${output.index + 1}`,
                sourceType: "text_generate",
                implementation:
                  request.provider === "mock" ? "demo" : "api_native",
                provider: job.provider,
                model: job.model,
                paramsSnapshot: job.requestParams,
                ...audio,
              },
            });
            await tx.jobOutput.update({
              where: { id: output.id },
              data: {
                status: "completed",
                assetPath: audio.assetPath,
                remoteUrl: null,
              },
            });
            await tx.project.update({
              where: { id: job.projectId },
              data: { updatedAt: new Date() },
            });
          });
          return;
        } catch (e) {
          if (attempt < 2) await delay(1000 * 2 ** attempt);
          else
            await db.jobOutput.update({
              where: { id: output.id },
              data: {
                status: "failed",
                errorMessage: redact(
                  e instanceof Error ? e.message : "音频保存失败",
                ),
              },
            });
        }
      }
    }),
  );
  const incomplete = await db.jobOutput.count({
    where: { jobId: id, status: { not: "completed" } },
  });
  await db.generationJob.update({
    where: { id },
    data: {
      status: incomplete ? "download_failed" : "succeeded",
      finishedAt: new Date(),
      errorMessage: incomplete
        ? "部分音频下载失败。已完成候选已保留，可只重试失败的下载。"
        : null,
    },
  });
}
