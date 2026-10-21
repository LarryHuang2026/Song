import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Sqlite from "better-sqlite3";
import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
const dir = mkdtempSync(path.join(tmpdir(), "song-ai-test-"));
process.env.MUSIC_DATA_ROOT = dir;
process.env.FLUXPORT_API_KEY = "test-fluxport-key";
process.env.SUNO_API_KEY = "";
const { db } = await import("../src/lib/db");
const { saveSunoKey, publicSunoSettings } =
  await import("../src/lib/ai-settings");
const { aiRequestSchema, aiDraftSchema } = await import("../src/lib/ai-domain");
const { processAiJob } = await import("../src/worker/ai-engine");
const { recoverJobs } = await import("../src/worker/engine");
const { saveAudio, makeDemoWav } = await import("../src/lib/audio");
const { redact } = await import("../src/lib/domain");
const key = "test-suno-secret-only";
beforeAll(() => {
  const raw = new Sqlite(path.join(dir, "studio.db"));
  for (const entry of readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    raw.exec(
      readFileSync(`prisma/migrations/${entry.name}/migration.sql`, "utf8"),
    );
  raw.close();
});
beforeEach(() => saveSunoKey(key));
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => {
  await db.$disconnect();
  await rm(dir, { recursive: true, force: true });
});
async function createJob(kind: "hum_cover" | "section_rewrite" = "hum_cover") {
  const project = await db.project.create({ data: { name: "AI 测试" } });
  const audio = await saveAudio(makeDemoWav(0), "wav");
  const base = await db.version.create({
    data: {
      projectId: project.id,
      ...audio,
      label: "原曲",
      sourceType: "import",
      implementation: "local",
      provider: "local",
      model: "original",
      paramsSnapshot: "{}",
      mimeType: "audio/wav",
    },
  });
  const humAudio = await saveAudio(makeDemoWav(1), "wav");
  const hum = await db.humAsset.create({
    data: {
      projectId: project.id,
      ...humAudio,
      label: "哼唱",
      originalPath: humAudio.assetPath,
      originalSha256: humAudio.sha256,
      originalMimeType: "audio/wav",
      originalDurationSec: humAudio.durationSec,
      analysisJson: "{}",
      processingJson: "{}",
    },
  });
  const input = aiRequestSchema.parse(
    kind === "hum_cover"
      ? {
          kind,
          humId: hum.id,
          title: "AI 测试",
          style: "钢琴",
          description: "延续参考旋律",
          audioWeight: 0.8,
        }
      : {
          kind,
          baseVersionId: base.id,
          startSec: 2,
          endSec: 5,
          contextLyrics: "这是完整歌词",
          infillLyrics: "新的歌词",
          title: "AI 段落",
          style: "钢琴",
        },
  );
  const job = await db.generationJob.create({
    data: {
      projectId: project.id,
      provider: "suno-api",
      model: input.model,
      requestParams: JSON.stringify(input),
      parentVersionId: kind === "section_rewrite" ? base.id : null,
    },
  });
  return { job, input, base, hum };
}
function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}
describe("AI 服务配置", () => {
  it("私有文件和公开响应中的 Key 隔离", () => {
    expect(
      statSync(path.join(dir, "provider-settings.json")).mode & 0o777,
    ).toBe(0o600);
    expect(JSON.stringify(publicSunoSettings())).not.toContain(key);
    expect(publicSunoSettings().configured).toBe(true);
    expect(redact(`problem ${key}`)).not.toContain(key);
    saveSunoKey("", null, true);
    expect(publicSunoSettings().configured).toBe(false);
  });
  it("草稿允许未完成的输入，但拒绝额外字段和过长文本", () => {
    const draft = {
      sourceId: "",
      title: "",
      style: "",
      model: "suno-v6",
      lyrics: "",
      description: "",
      weight: 0.7,
      instrumental: false,
      start: 10,
      end: 0,
      windowLyrics: "",
      infillLyrics: "",
      fade: 30,
    };
    expect(aiDraftSchema.parse(draft).end).toBe(0);
    expect(() =>
      aiDraftSchema.parse({ ...draft, apiKey: "not-a-draft-field" }),
    ).toThrow();
    expect(() =>
      aiDraftSchema.parse({ ...draft, lyrics: "x".repeat(8001) }),
    ).toThrow();
  });
  it("拒绝过短 AI 重写区间和越界音频权重", () => {
    expect(() =>
      aiRequestSchema.parse({
        kind: "section_rewrite",
        title: "测试",
        style: "钢琴",
        baseVersionId: crypto.randomUUID(),
        startSec: 1,
        endSec: 2,
        contextLyrics: "完整歌词",
        infillLyrics: "新词",
      }),
    ).toThrow();
    expect(() =>
      aiRequestSchema.parse({
        kind: "hum_cover",
        title: "测试",
        style: "钢琴",
        humId: crypto.randomUUID(),
        description: "旋律",
        audioWeight: 1.1,
      }),
    ).toThrow();
  });
});
describe("真实协议模拟（没有外部调用）", () => {
  it("纯音乐不把保留的歌词当作主提示发送", async () => {
    const { submitSuno } = await import("../src/lib/suno-provider");
    const input = aiRequestSchema.parse({
      kind: "hum_cover",
      humId: crypto.randomUUID(),
      title: "纯音乐",
      style: "钢琴",
      description: "安静的钢琴器乐",
      lyrics: "这句歌词不能被发送",
      instrumental: true,
    });
    const fake = vi.fn().mockResolvedValue(
      json({
        code: 200,
        data: {
          clips: [{ song_id: "instrumental-test", status: "pending" }],
        },
      }),
    );
    vi.stubGlobal("fetch", fake);
    await submitSuno(input, "source-test");
    const sent = JSON.parse(fake.mock.calls[0][1].body);
    expect(sent.instrumental).toBe(true);
    expect(sent.customMode).toBe(false);
    expect(sent.prompt).toBe("安静的钢琴器乐");
    expect(JSON.stringify(sent)).not.toContain("这句歌词不能被发送");
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it("上传 → 收费受理 → 重启恢复查询 → 下载，只提交一次生成", async () => {
    const { job, input } = await createJob();
    let polls = 0;
    const fake = vi.fn(async (url: string | URL, options?: RequestInit) => {
      const address = String(url);
      if (address.endsWith("/upload-source")) {
        expect(options?.body).toBeInstanceOf(FormData);
        return json({ clip_id: "source-1", status: "complete" });
      }
      if (address.endsWith("/generate-from-source")) {
        const body = JSON.parse(options!.body as string);
        expect(body.sourceClipId).toBe("source-1");
        expect(body.audio_weight).toBe(
          input.kind === "hum_cover" ? input.audioWeight : 0,
        );
        return json({
          code: 200,
          data: { clips: [{ song_id: "song-1", status: "pending" }] },
        });
      }
      if (address.endsWith("/query")) {
        expect(JSON.parse(options!.body as string).song_ids).toBe("song-1");
        return json([
          {
            song_id: "song-1",
            status: ++polls === 1 ? "pending" : "completed",
            audio_url: polls === 1 ? "" : "https://8.8.8.8/ai.wav",
          },
        ]);
      }
      expect(options?.headers).toBeUndefined();
      return new Response(new Uint8Array(makeDemoWav(1)), {
        headers: { "Content-Type": "audio/wav" },
      });
    });
    vi.stubGlobal("fetch", fake);
    await processAiJob(job.id);
    expect(
      (await db.generationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("running");
    await recoverJobs();
    await db.generationJob.update({
      where: { id: job.id },
      data: { nextPollAt: null },
    });
    await processAiJob(job.id);
    await processAiJob(job.id);
    expect(
      (await db.generationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("succeeded");
    expect(
      fake.mock.calls.filter(([u]) =>
        String(u).endsWith("/generate-from-source"),
      ),
    ).toHaveLength(1);
    expect(
      fake.mock.calls.filter(([u]) => String(u).endsWith("/upload-source")),
    ).toHaveLength(1);
    const version = await db.version.findFirstOrThrow({
      where: { projectId: job.projectId, sourceType: "hum_generate" },
    });
    expect(version.implementation).toBe("audio_reference_unverified");
    expect(JSON.parse(version.paramsSnapshot).humId).toBe(
      input.kind === "hum_cover" ? input.humId : "",
    );
  });
  it("收费提交断线后保留未知状态，不自动重试", async () => {
    const { job } = await createJob();
    const fake = vi.fn(async (url: string) => {
      if (String(url).endsWith("/upload-source"))
        return json({ clip_id: "source", status: "complete" });
      throw new Error("connection reset");
    });
    vi.stubGlobal("fetch", fake);
    await processAiJob(job.id);
    await recoverJobs();
    await processAiJob(job.id);
    expect(
      (await db.generationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("unknown_submission");
    expect(fake).toHaveBeenCalledTimes(2);
    expect(await db.jobOutput.count({ where: { jobId: job.id } })).toBe(0);
  });
  it("查询失败后保留歌曲 ID；不重新收费", async () => {
    const { job } = await createJob();
    await db.generationJob.update({
      where: { id: job.id },
      data: {
        status: "running",
        providerTaskId: '["known-song"]',
        pollFailures: 7,
        pollStartedAt: new Date(),
      },
    });
    await db.jobOutput.create({
      data: { jobId: job.id, index: 0, providerSongId: "known-song" },
    });
    const fake = vi.fn(async () => new Response("error", { status: 503 }));
    vi.stubGlobal("fetch", fake);
    await processAiJob(job.id);
    const result = await db.generationJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(result.status).toBe("poll_failed");
    expect(result.providerTaskId).toContain("known-song");
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("恢复已下载候选不重复上传、提交或下载", async () => {
    const { job } = await createJob();
    const audio = await saveAudio(makeDemoWav(1), "wav");
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "downloading" },
    });
    await db.jobOutput.create({
      data: {
        jobId: job.id,
        index: 0,
        status: "failed",
        rawAssetPath: audio.assetPath,
        rawMimeType: "audio/wav",
        providerSongId: "known-song",
      },
    });
    const fake = vi.fn().mockRejectedValue(new Error("must not call"));
    vi.stubGlobal("fetch", fake);
    await processAiJob(job.id);
    expect(fake).not.toHaveBeenCalled();
    expect(
      (await db.generationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("succeeded");
  });
  it("AI 段落输出进入本地重建，记录父版本，不改写原曲", async () => {
    const { job, base } = await createJob("section_rewrite");
    const audio = await saveAudio(makeDemoWav(1), "wav");
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "downloading" },
    });
    await db.jobOutput.create({
      data: {
        jobId: job.id,
        index: 0,
        status: "postprocessing",
        rawAssetPath: audio.assetPath,
        rawMimeType: "audio/wav",
        providerSongId: "replacement",
      },
    });
    const fake = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      expect(body.start_sec).toBe(2);
      expect(body.source_start_sec).toBe(2);
      expect(body.end_sec).toBe(5);
      await writeFile(path.join(dir, body.dst), makeDemoWav(1));
      return json({
        path: body.dst,
        durationSec: 8,
        metadata: {
          startSec: 2,
          endSec: 5,
          sourceStartSec: 2,
          crossfadeMs: 30,
          gain: 1,
          outsideRegionUnchanged: true,
          peak: 0.3,
          sampleRate: 44100,
          note: "test",
        },
      });
    });
    vi.stubGlobal("fetch", fake);
    await processAiJob(job.id);
    const version = await db.version.findFirstOrThrow({
      where: { output: { jobId: job.id } },
    });
    expect(version.parentVersionId).toBe(base.id);
    expect(version.implementation).toBe("experimental_ai_local");
    expect(
      JSON.parse(version.paramsSnapshot).localRebuild.outsideRegionUnchanged,
    ).toBe(true);
    expect(
      (await db.version.findUniqueOrThrow({ where: { id: base.id } })).sha256,
    ).toBe(base.sha256);
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
