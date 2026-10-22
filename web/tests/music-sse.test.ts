import { afterEach, expect, it, vi } from "vitest";
process.env.FLUXPORT_API_KEY = "test-stream-only-key";
const { generate, ProviderError } = await import("../src/lib/provider");
const { generationSchema, generationSnapshotSchema, buildPrompt } =
  await import("../src/lib/domain");
afterEach(() => vi.unstubAllGlobals());

function streamed(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        // Split UTF-8 characters, data prefixes, CRLFs and JSON across chunks.
        for (let i = 0; i < bytes.length; i++)
          controller.enqueue(bytes.slice(i, i + 1));
        controller.close();
      },
    }),
    {
      headers: {
        "content-type": "text/event-stream",
        "x-request-id": "stream-test-1",
      },
    },
  );
}
function event(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`;
}
it("解析保活、多段内容、UTF-8 分片与结束标记，得到完整音频链接", async () => {
  const fake = vi
    .fn()
    .mockResolvedValue(
      streamed(
        ": heartbeat\r\n\r\n" +
          event("芷溪：[试听](https://music.example/") +
          ": waiting\r\n\r\n" +
          event("a.mp3?signature=kept)") +
          'data: {"choices":[],"usage":{"total_tokens":0}}\r\n\r\ndata: [DONE]\r\n\r\n',
      ),
    );
  vi.stubGlobal("fetch", fake);
  expect(
    await generate(
      generationSchema.parse({ description: "原创女声民谣", model: "suno-v6" }),
    ),
  ).toEqual({
    urls: ["https://music.example/a.mp3?signature=kept"],
    requestId: "stream-test-1",
  });
  expect(fake).toHaveBeenCalledTimes(1);
});

it.each([
  "suno-v5",
  "suno-v5.5",
  "suno-v6",
  "suno-v6-mini",
  "suno-v6-wild",
] as const)(
  "%s 发送精确版本、流式和原生纯音乐参数，兼容 JSON 结果",
  async (model) => {
    const fake = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ url: "https://music.example/a.mp3" }] }),
        ),
      );
    vi.stubGlobal("fetch", fake);
    await generate(
      generationSchema.parse({
        model,
        description: "钢琴",
        instrumental: true,
        lyrics: "不应发送",
      }),
    );
    const body = JSON.parse(fake.mock.calls[0][1].body);
    expect(body).toMatchObject({
      model,
      stream: true,
      n: 1,
      instrumental: true,
    });
    expect(Object.keys(body).sort()).toEqual([
      "instrumental",
      "messages",
      "model",
      "n",
      "stream",
    ]);
    expect(body.messages[0].content).not.toContain("不应发送");
    expect(fake).toHaveBeenCalledTimes(1);
  },
);

it("新版合并提示词超过 3000 时不提交，Lyria 仍使用 10000 上限，历史快照可读取", async () => {
  const fields = { description: "a".repeat(1500), lyrics: "b".repeat(1600) };
  expect(() => generationSchema.parse({ ...fields, model: "suno-v6" })).toThrow(
    /3000/,
  );
  expect(() =>
    generationSchema.parse({ ...fields, model: "Lyria-3.5音频音乐" }),
  ).not.toThrow();
  const old = generationSnapshotSchema.parse({ ...fields, model: "suno-v6" });
  expect(buildPrompt(old).length).toBeGreaterThan(3000);
  const fake = vi.fn();
  vi.stubGlobal("fetch", fake);
  await expect(generate(old)).rejects.toMatchObject({ uncertain: false });
  expect(fake).not.toHaveBeenCalled();
});

it("HTTP 200 的事件流错误、空 DONE 和断流均视为结果未知，不重试", async () => {
  for (const text of [
    'data: {"error":{"code":"music_result_unconfirmed","message":"private upstream detail"}}\n\ndata: [DONE]\n\n',
    'data: {"code":"music_result_unconfirmed"}\n\ndata: [DONE]\n\n',
    "data: [DONE]\n\n",
    event("https://music.example/incomplete.mp3"),
    event("https://music.example/partial.mp3") +
      'data: {"error":"late failure"}\n\ndata: [DONE]\n\n',
  ]) {
    const fake = vi.fn().mockResolvedValue(streamed(text));
    vi.stubGlobal("fetch", fake);
    const error = await generate(
      generationSchema.parse({ description: "民谣" }),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({
      uncertain: true,
      requestId: "stream-test-1",
    });
    expect(error.message).not.toContain("private upstream detail");
    expect(fake).toHaveBeenCalledTimes(1);
  }
});

it("Lyria 不带未经确认的 n、instrumental 参数，保持非流式", async () => {
  const fake = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ url: "https://music.example/a.mp3" }] }),
      ),
    );
  vi.stubGlobal("fetch", fake);
  await generate(
    generationSchema.parse({
      model: "Lyria-3pro音频音乐",
      description: "钢琴",
    }),
  );
  expect(Object.keys(JSON.parse(fake.mock.calls[0][1].body)).sort()).toEqual([
    "messages",
    "model",
    "stream",
  ]);
  expect(JSON.parse(fake.mock.calls[0][1].body).stream).toBe(false);
});

it("JSON 回退中的未确认错误不会被同时返回的链接掩盖", async () => {
  const fake = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: { code: "music_result_unconfirmed" },
        data: [{ url: "https://music.example/unconfirmed.mp3" }],
      }),
    ),
  );
  vi.stubGlobal("fetch", fake);
  await expect(
    generate(generationSchema.parse({ description: "原创歌曲" })),
  ).rejects.toMatchObject({ uncertain: true });
  expect(fake).toHaveBeenCalledTimes(1);
});
