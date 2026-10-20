import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
function wav() {
  const rate = 44100,
    count = rate * 8,
    bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(36 + count * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    bytes.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 11000),
      44 + 2 * i,
    );
  return bytes;
}
test("首页直达 AI → 配置连接 → 参考生成 → 段落重写 → 候选与父版本", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "打开 AI 哼唱成曲", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "AI 哼唱成曲", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("待填写 Key", { exact: true })).toBeVisible();
  const key = "test-suno-e2e-secret";
  await page.getByLabel("Suno-API Key").fill(key);
  await page.getByRole("button", { name: "保存并检测连接" }).click();
  await expect(
    page.getByText("已配置 · 鉴权已验证", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Suno-API Key")).toHaveValue("");
  const publicConfig = await (await request.get("/api/ai/config")).text();
  expect(publicConfig).not.toContain(key);
  expect(JSON.parse(publicConfig).configured).toBe(true);
  const state = await (await request.get("/api/state")).json(),
    project = state.projects[0];
  const data = wav();
  const original = await (
    await request.post(`/api/projects/${project.id}/import`, {
      multipart: {
        file: { name: "AI 原曲.wav", mimeType: "audio/wav", buffer: data },
      },
    })
  ).json();
  const humResponse = await request.post(`/api/projects/${project.id}/hums`, {
    multipart: {
      file: { name: "AI 哼唱.wav", mimeType: "audio/wav", buffer: data },
    },
  });
  expect(humResponse.status()).toBe(201);
  const hum = await humResponse.json();
  await expect(page.getByLabel("参考哼唱").locator("option")).toHaveCount(2, {
    timeout: 10000,
  });
  await page.getByLabel("参考哼唱").selectOption(hum.id);
  await page
    .getByRole("button", { name: "开始 AI 哼唱成曲", exact: true })
    .click();
  await expect(page.locator(".ai-result")).toHaveCount(2, { timeout: 40000 });
  await expect(
    page.getByText("API 音频参考 · 旋律遵循度待评估", { exact: false }),
  ).toHaveCount(2);
  const stats = await (
    await request.get("http://127.0.0.1:8198/__stats")
  ).json();
  expect(stats.covers).toBe(1);
  expect(stats.lastCover.sourceClipId).toBeTruthy();
  expect(stats.lastCover.audio_weight).toBe(0.7);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("ai-cover.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "AI 段落重写", exact: true }).click();
  await page.getByLabel("原曲版本", { exact: true }).selectOption(original.id);
  await page.getByLabel("AI 开始时间（秒）").fill("2");
  await page.getByLabel("AI 结束时间（秒）").fill("5");
  await page
    .getByLabel("整首歌词上下文")
    .fill("[主歌]这是原曲歌词 [副歌]记住每一个旋律");
  await page.getByLabel("替换段的新歌词").fill("新的片段，新的开始");
  await page
    .getByRole("button", { name: "开始 AI 段落重写", exact: true })
    .click();
  await expect(page.locator(".ai-result")).toHaveCount(2, { timeout: 40000 });
  const updated = await (await request.get("/api/state")).json(),
    p = updated.projects.find((p: { id: string }) => p.id === project.id);
  const results = p.versions.filter(
    (v: { sourceType: string }) => v.sourceType === "section_edit",
  );
  expect(results).toHaveLength(2);
  expect(results[0].parentVersionId).toBe(original.id);
  expect(results[0].implementation).toBe("experimental_ai_local");
  expect(
    JSON.parse(results[0].paramsSnapshot).localRebuild.outsideRegionUnchanged,
  ).toBe(true);
  expect((await request.get(`/api/audio/${original.id}`)).status()).toBe(200);
  expect(
    p.versions.find((v: { id: string }) => v.id === original.id).sha256,
  ).toBe(createHash("sha256").update(data).digest("hex"));
  expect(JSON.stringify(updated)).not.toContain(key);
  const finalStats = await (
    await request.get("http://127.0.0.1:8198/__stats")
  ).json();
  expect(finalStats.replacements).toBe(1);
  await page.screenshot({
    path: testInfo.outputPath("ai-rewrite.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "文字创作", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "AI 段落重写 · 候选 1", exact: true }),
  ).toBeVisible();
});
test("未配置 Key 的真实提交返回明确错误；配置接口拒绝跨站写入", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/ai/config", {
        headers: { Origin: "https://evil.example" },
        data: { action: "save", apiKey: "should-not-save" },
      })
    ).status(),
  ).toBe(403);
  await request.post("/api/ai/config", { data: { action: "clear" } });
  const p = await (
    await request.post("/api/projects", { data: { name: "未配置 Key" } })
  ).json();
  const response = await request.post(`/api/projects/${p.id}/ai-jobs`, {
    data: {
      clientRequestId: crypto.randomUUID(),
      kind: "hum_cover",
      humId: crypto.randomUUID(),
      title: "测试",
      style: "流行",
      description: "音乐",
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain("API Key");
});
