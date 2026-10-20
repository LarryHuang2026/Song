import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Sqlite from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const dataRoot = mkdtempSync(path.join(tmpdir(), "song-test-"));
process.env.MUSIC_DATA_ROOT = dataRoot;
process.env.FLUXPORT_API_KEY = "test-only-key";
const { db } = await import("../src/lib/db");
const { generationSchema, buildPrompt, redact } =
  await import("../src/lib/domain");
const { processJob, recoverJobs } = await import("../src/worker/engine");
const { extractLinks, generate, ProviderError } =
  await import("../src/lib/provider");
const { validateRemoteUrl, downloadAudio } =
  await import("../src/lib/download");
const { assetPath, makeDemoWav, saveAudio } = await import("../src/lib/audio");
beforeAll(() => {
  const raw = new Sqlite(path.join(dataRoot, "studio.db"));
  for (const migration of readdirSync("prisma/migrations", {
    withFileTypes: true,
  })
    .filter((e) => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    raw.exec(
      readFileSync(`prisma/migrations/${migration.name}/migration.sql`, "utf8"),
    );
  }
  raw.close();
});
afterAll(async () => {
  await db.$disconnect();
  await rm(dataRoot, { recursive: true, force: true });
});
async function createJob(provider: "mock" | "fluxport" = "mock") {
  const p = await db.project.create({ data: { name: "测试歌曲" } });
  const request = generationSchema.parse({
    description: "清晨的钢琴曲",
    lyrics: "原创歌词",
    provider,
  });
  return db.generationJob.create({
    data: {
      projectId: p.id,
      provider,
      model: request.model,
      requestParams: JSON.stringify(request),
    },
  });
}
describe("领域约束与接口结果", () => {
  it("校验时长、输入长度与合并后的提示词长度", () => {
    expect(() => generationSchema.parse({ description: "  " })).toThrow();
    expect(() =>
      generationSchema.parse({ description: "歌曲", duration: 301 }),
    ).toThrow();
    expect(() =>
      generationSchema.parse({
        description: "a".repeat(2000),
        lyrics: "b".repeat(8000),
      }),
    ).toThrow();
    const value = generationSchema.parse({
      description: "雨天",
      lyrics: "不使用这句歌词",
      instrumental: true,
    });
    expect(buildPrompt(value)).not.toContain("不使用这句歌词");
  });
  it("兼容 Suno Markdown 与 Lyria data 结构并去重", () => {
    expect(
      extractLinks({
        choices: [
          {
            message: {
              content:
                "[歌曲](https://music.example/a.mp3?signature=secret)\n[歌曲](https://music.example/a.mp3?signature=secret)",
            },
          },
        ],
      }),
    ).toEqual(["https://music.example/a.mp3?signature=secret"]);
    expect(
      extractLinks({
        data: [{ url: "https://music.example/b.mp3" }],
        choices: [
          { message: { content: "[重复](https://music.example/b.mp3)" } },
        ],
      }),
    ).toEqual(["https://music.example/b.mp3"]);
    expect(() => extractLinks({ choices: [] })).toThrow();
  });
  it("错误脱敏与本地路径/URL 保护", async () => {
    expect(
      redact(
        "Bearer sk-abcdefghijkl https://music.example/a?signature=secret&token=test",
      ),
    ).not.toMatch(/abcdefghijkl|secret|token=test/);
    await expect(
      validateRemoteUrl("https://127.0.0.1/a.mp3"),
    ).rejects.toThrow();
    await expect(validateRemoteUrl("https://[::1]/a.mp3")).rejects.toThrow();
    await expect(
      validateRemoteUrl("http://example.com/a.mp3"),
    ).rejects.toThrow();
    await expect(assetPath("../../etc/hosts")).rejects.toThrow();
  });
});
describe("真实 Provider 协议（模拟 HTTP，不访问外部）", () => {
  it("真实适配器的生成与流式下载完整落盘，不把凭据带给音频域名", async () => {
    const wav = makeDemoWav(0);
    const fake = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ url: "https://8.8.8.8/test.wav" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array(wav), {
          headers: {
            "Content-Type": "audio/wav",
            "Content-Length": String(wav.length),
          },
        }),
      );
    vi.stubGlobal("fetch", fake);
    try {
      const job = await createJob("fluxport");
      await processJob(job.id);
      expect(
        (await db.generationJob.findUniqueOrThrow({ where: { id: job.id } }))
          .status,
      ).toBe("succeeded");
      const version = await db.version.findFirstOrThrow({
        where: { projectId: job.projectId },
      });
      expect(version.implementation).toBe("api_native");
      expect(version.durationSec).toBeCloseTo(8);
      expect(readFileSync(await assetPath(version.assetPath))).toEqual(wav);
      expect(fake).toHaveBeenCalledTimes(2);
      expect(fake.mock.calls[1][1]).not.toHaveProperty("headers");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("下载拒绝 HTML、截断文件及重定向到内网的链接", async () => {
    for (const response of [
      new Response("error", { headers: { "Content-Type": "text/html" } }),
      new Response("short", {
        headers: { "Content-Type": "audio/wav", "Content-Length": "1000" },
      }),
      new Response(null, {
        status: 302,
        headers: { Location: "https://127.0.0.1/secret" },
      }),
    ]) {
      const fake = vi.fn().mockResolvedValue(response);
      vi.stubGlobal("fetch", fake);
      try {
        await expect(
          downloadAudio("https://8.8.8.8/test.wav", async () => {}),
        ).rejects.toThrow();
        expect(fake).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
  it("只提交一次非流式请求，不把歌词和时长伪装为原生参数", async () => {
    const fake = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ url: "https://music.example/a.mp3" }] }),
          { status: 200, headers: { "x-request-id": "trace-1" } },
        ),
      );
    vi.stubGlobal("fetch", fake);
    try {
      const request = generationSchema.parse({
        description: "钢琴",
        provider: "fluxport",
        lyrics: "你好",
        duration: 300,
      });
      expect(await generate(request)).toEqual({
        urls: ["https://music.example/a.mp3"],
        requestId: "trace-1",
      });
      expect(fake).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fake.mock.calls[0][1].body);
      expect(body.stream).toBe(false);
      expect(Object.keys(body).sort()).toEqual(["messages", "model", "stream"]);
      expect(body.messages[0].content).toContain("你好");
      expect(body.messages[0].content).toContain("300");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("网络中断/5xx/成功但结果不可读都保留未知状态；鉴权失败为明确失败", async () => {
    const request = generationSchema.parse({
      description: "测试歌曲",
      provider: "fluxport",
    });
    for (const outcome of [
      new Error("connection reset"),
      new Response("upstream secret", { status: 502 }),
      new Response("not json", { status: 200 }),
      new Response("unauthorized", { status: 401 }),
    ]) {
      const fake =
        outcome instanceof Error
          ? vi.fn().mockRejectedValue(outcome)
          : vi.fn().mockResolvedValue(outcome);
      vi.stubGlobal("fetch", fake);
      try {
        const error = await generate(request).catch((e) => e);
        expect(error).toBeInstanceOf(ProviderError);
        expect(error.uncertain).toBe(
          !(outcome instanceof Response && outcome.status === 401),
        );
        expect(error.message).not.toContain("upstream secret");
        expect(fake).toHaveBeenCalledTimes(1);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  });
});
describe("任务、音频和崩溃恢复", () => {
  it("无效导入不留下半写入的音频文件", async () => {
    const before = await readdir(path.join(dataRoot, "audio")).catch(() => []);
    await expect(
      saveAudio(Buffer.from("not an audio file"), "wav"),
    ).rejects.toThrow();
    expect(await readdir(path.join(dataRoot, "audio"))).toEqual(before);
  });
  it("并发认领只创作一次；两首候选可试听，保留参数与哈希", async () => {
    const job = await createJob();
    await Promise.all([processJob(job.id), processJob(job.id)]);
    const result = await db.generationJob.findUniqueOrThrow({
      where: { id: job.id },
      include: { outputs: { include: { version: true } } },
    });
    expect(result.status).toBe("succeeded");
    expect(result.outputs).toHaveLength(2);
    for (const output of result.outputs) {
      expect(output.status).toBe("completed");
      expect(output.remoteUrl).toBeNull();
      const version = output.version!;
      expect(version.implementation).toBe("demo");
      expect(version.durationSec).toBeCloseTo(8, 1);
      expect(version.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.parse(version.paramsSnapshot).lyrics).toBe("原创歌词");
      const file = readFileSync(await assetPath(version.assetPath));
      expect(file.subarray(0, 4).toString()).toBe("RIFF");
    }
    await processJob(job.id);
    expect(
      await db.version.count({ where: { projectId: job.projectId } }),
    ).toBe(2);
  });
  it("崩溃后的提交进入未知状态，恢复时不会重新生成", async () => {
    const job = await createJob();
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "submitting" },
    });
    await recoverJobs();
    await processJob(job.id);
    expect(
      (await db.generationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("unknown_submission");
    expect(await db.jobOutput.count({ where: { jobId: job.id } })).toBe(0);
  });
  it("下载恢复跳过已保存候选，不覆盖原始音频或重复创建版本", async () => {
    const job = await createJob();
    await processJob(job.id);
    const existing = await db.version.findFirstOrThrow({
      where: { projectId: job.projectId },
    });
    await db.jobOutput.create({
      data: { jobId: job.id, index: 2, remoteUrl: "demo:2", status: "failed" },
    });
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "downloading" },
    });
    await recoverJobs();
    await processJob(job.id);
    expect(
      await db.version.count({ where: { projectId: job.projectId } }),
    ).toBe(3);
    expect(
      (await db.version.findUniqueOrThrow({ where: { id: existing.id } }))
        .sha256,
    ).toBe(existing.sha256);
    expect(
      (await db.generationJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
    ).toBe("succeeded");
  });
});
