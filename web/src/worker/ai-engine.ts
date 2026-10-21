import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { aiRequestSchema } from "../lib/ai-domain";
import { uploadSunoSource, submitSuno, pollSuno } from "../lib/suno-provider";
import { ProviderError } from "../lib/provider";
import { downloadAudio } from "../lib/download";
import { assetPath, inspectAudio } from "../lib/audio";
import { callAudioService, replacedSchema } from "../lib/local-audio";
import { redact } from "../lib/domain";
const terminalSuccess = new Set(["completed", "complete", "succeeded"]),
  terminalFailure = new Set(["error", "failed", "cancelled"]);
export async function processAiJob(id: string) {
  let job = await db.generationJob.findUniqueOrThrow({ where: { id } });
  let input;
  try {
    input = aiRequestSchema.parse(JSON.parse(job.requestParams));
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
    if (
      !(
        await db.generationJob.updateMany({
          where: { id, status: "queued" },
          data: { status: "uploading", errorMessage: null },
        })
      ).count
    )
      return;
    let sourceId = job.providerSourceId;
    try {
      if (!sourceId) {
        const source =
          input.kind === "hum_cover"
            ? await db.humAsset.findFirst({
                where: { id: input.humId, projectId: job.projectId },
              })
            : await db.version.findFirst({
                where: { id: input.baseVersionId, projectId: job.projectId },
              });
        if (!source) throw new ProviderError("源音频不存在，未提交生成", false);
        sourceId = await uploadSunoSource(source.assetPath, job.model);
        await db.generationJob.update({
          where: { id },
          data: { providerSourceId: sourceId },
        });
      }
    } catch (e) {
      await db.generationJob.update({
        where: { id },
        data: {
          status: "failed",
          errorMessage: redact(
            e instanceof Error ? e.message : "音频上传失败，本次未提交生成",
          ),
          finishedAt: new Date(),
        },
      });
      return;
    }
    await db.generationJob.update({
      where: { id },
      data: { status: "submitting", submittedAt: new Date() },
    });
    try {
      const clips = await submitSuno(input, sourceId);
      if (new Set(clips.map((c) => c.song_id)).size !== clips.length)
        throw new ProviderError(
          "服务返回重复歌曲 ID，提交状态需人工核对",
          true,
        );
      await db.$transaction(async (tx) => {
        for (const [index, clip] of clips.entries())
          await tx.jobOutput.create({
            data: {
              jobId: id,
              index,
              providerSongId: clip.song_id,
              status: "pending",
            },
          });
        await tx.generationJob.update({
          where: { id },
          data: {
            providerTaskId: JSON.stringify(clips.map((c) => c.song_id)),
            status: "running",
            nextPollAt: null,
            pollStartedAt: new Date(),
          },
        });
      });
    } catch (e) {
      await db.generationJob.update({
        where: { id },
        data: {
          status:
            e instanceof ProviderError && !e.uncertain
              ? "failed"
              : "unknown_submission",
          errorMessage: redact(
            e instanceof Error ? e.message : "提交状态未知，请核对平台记录",
          ),
          finishedAt: new Date(),
        },
      });
      return;
    }
  }
  job = await db.generationJob.findUniqueOrThrow({ where: { id } });
  if (job.status === "running") {
    if (job.nextPollAt && job.nextPollAt.getTime() > Date.now()) return;
    try {
      const outputs = await db.jobOutput.findMany({ where: { jobId: id } }),
        ids = outputs.map((o) => o.providerSongId!).filter(Boolean);
      if (!ids.length) throw new Error("没有可查询的歌曲 ID");
      const clips = await pollSuno(ids, job.model);
      for (const output of outputs) {
        const clip = clips.find((c) => c.song_id === output.providerSongId);
        if (!clip) continue;
        if (terminalFailure.has(clip.status))
          await db.jobOutput.update({
            where: { id: output.id },
            data: {
              status: "generation_failed",
              errorMessage: "服务商未能生成此候选；没有重新提交",
            },
          });
        else if (
          (terminalSuccess.has(clip.status) &&
            clip.audio_url?.startsWith("https://")) ||
          (terminalSuccess.has(clip.status) &&
            process.env.MUSIC_E2E === "1" &&
            clip.audio_url?.startsWith("http://127.0.0.1:"))
        ) {
          await db.jobOutput.update({
            where: { id: output.id },
            data: {
              status: "ready",
              remoteUrl: clip.audio_url,
              errorMessage: null,
            },
          });
        }
      }
      const pending = await db.jobOutput.count({
        where: { jobId: id, status: "pending" },
      });
      if (pending) {
        if (
          job.pollStartedAt &&
          Date.now() - job.pollStartedAt.getTime() > 3600000
        )
          await db.generationJob.update({
            where: { id },
            data: {
              status: "poll_failed",
              errorMessage:
                "等待超过一小时。歌曲 ID 已保留，可以继续免费查询。",
              finishedAt: new Date(),
            },
          });
        else
          await db.generationJob.update({
            where: { id },
            data: { nextPollAt: new Date(Date.now() + 8000), pollFailures: 0 },
          });
        return;
      }
      const ready = await db.jobOutput.count({
        where: { jobId: id, status: "ready" },
      });
      await db.generationJob.update({
        where: { id },
        data: {
          status: ready ? "downloading" : "failed",
          nextPollAt: null,
          errorMessage: ready ? null : "服务商生成失败，未重新提交",
          ...(ready ? {} : { finishedAt: new Date() }),
        },
      });
    } catch (e) {
      const failures = job.pollFailures + 1;
      await db.generationJob.update({
        where: { id },
        data: {
          status: failures >= 8 ? "poll_failed" : "running",
          pollFailures: failures,
          nextPollAt: new Date(
            Date.now() + Math.min(60000, 5000 * 2 ** Math.min(failures, 4)),
          ),
          errorMessage:
            failures >= 8
              ? "查询连续失败，歌曲 ID 已保留。可继续查询，不会重新生成。"
              : redact(e instanceof Error ? e.message : "查询暂时失败"),
        },
      });
      return;
    }
  }
  job = await db.generationJob.findUniqueOrThrow({ where: { id } });
  if (job.status !== "downloading") return;
  const outputs = await db.jobOutput.findMany({
    where: { jobId: id, status: { notIn: ["completed", "generation_failed"] } },
  });
  await Promise.all(
    outputs.map(async (output) => {
      try {
        let rawPath = output.rawAssetPath,
          rawMimeType = output.rawMimeType;
        if (!rawPath) {
          let downloaded;
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
              downloaded = await downloadAudio(
                output.remoteUrl!,
                async (receivedBytes, totalBytes) => {
                  await db.jobOutput.update({
                    where: { id: output.id },
                    data: { receivedBytes, totalBytes },
                  });
                },
              );
              break;
            } catch (e) {
              if (attempt === 2) throw e;
              await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
            }
          }
          rawPath = downloaded!.assetPath;
          rawMimeType = downloaded!.mimeType;
          await db.jobOutput.update({
            where: { id: output.id },
            data: {
              rawAssetPath: rawPath,
              rawMimeType,
              status: "postprocessing",
            },
          });
        }
        let audio = {
          assetPath: rawPath!,
          mimeType: rawMimeType!,
          ...(await inspectAudio(await assetPath(rawPath!))),
        };
        let metadata: unknown = null;
        if (input.kind === "section_rewrite") {
          const base = await db.version.findFirstOrThrow({
            where: { id: input.baseVersionId, projectId: job.projectId },
          });
          if (
            Math.abs(audio.durationSec - base.durationSec) > 2 ||
            audio.durationSec < input.endSec
          )
            throw new Error(
              "模型返回音频与原曲长度不一致，未猜测片段位置。原始结果已保留，请核对服务商输出。",
            );
          const dst = `audio/${randomUUID()}.wav`;
          const result = await callAudioService(
            "/replace",
            {
              base: base.assetPath,
              replacement: rawPath,
              dst,
              start_sec: input.startSec,
              end_sec: input.endSec,
              source_start_sec: input.startSec,
              crossfade_ms: input.crossfadeMs,
              match_level: false,
            },
            replacedSchema,
          );
          if (result.path !== dst) throw new Error("本地重建输出路径不一致");
          audio = {
            assetPath: dst,
            mimeType: "audio/wav",
            ...(await inspectAudio(await assetPath(dst))),
          };
          metadata = result.metadata;
        }
        await db.$transaction(async (tx) => {
          await tx.version.create({
            data: {
              projectId: job.projectId,
              outputId: output.id,
              parentVersionId: job.parentVersionId,
              label: `${input.kind === "hum_cover" ? "AI 哼唱参考" : "AI 段落重写"} · 候选 ${output.index + 1}`,
              sourceType:
                input.kind === "hum_cover" ? "hum_generate" : "section_edit",
              implementation:
                input.kind === "hum_cover"
                  ? "audio_reference_unverified"
                  : "experimental_ai_local",
              provider: "suno-api",
              model: job.model,
              paramsSnapshot: JSON.stringify({
                ...input,
                providerSongId: output.providerSongId,
                capabilityStatus: "experimental",
                ...(metadata ? { localRebuild: metadata } : {}),
              }),
              ...audio,
            },
          });
          await tx.jobOutput.update({
            where: { id: output.id },
            data: {
              status: "completed",
              assetPath: audio.assetPath,
              remoteUrl: null,
              errorMessage: null,
            },
          });
          await tx.project.update({
            where: { id: job.projectId },
            data: { updatedAt: new Date() },
          });
        });
      } catch (e) {
        await db.jobOutput.update({
          where: { id: output.id },
          data: {
            status: "failed",
            errorMessage: redact(
              e instanceof Error ? e.message : "结果保存失败",
            ),
          },
        });
      }
    }),
  );
  const failed = await db.jobOutput.count({
      where: { jobId: id, status: "failed" },
    }),
    generationFailed = await db.jobOutput.count({
      where: { jobId: id, status: "generation_failed" },
    });
  await db.generationJob.update({
    where: { id },
    data: {
      status: failed ? "download_failed" : "succeeded",
      finishedAt: new Date(),
      errorMessage: failed
        ? "部分候选下载或本地处理失败。可只恢复结果保存，不会重新生成。"
        : generationFailed
          ? `已保存可用候选，${generationFailed} 个候选在服务商生成失败。`
          : null,
    },
  });
}
