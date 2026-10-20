import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
function sineWav(frequency: number, seconds: number) {
  const rate = 44100,
    count = Math.round(rate * seconds),
    data = Buffer.alloc(44 + count * 2);
  data.write("RIFF");
  data.writeUInt32LE(36 + count * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * frequency * i) / rate) * 12000),
      44 + i * 2,
    );
  return data;
}
test("上传/分析哼唱 → 原音哈希 → 另存预处理 → 片段替换 → A/B → 刷新保留", async ({
  page,
  request,
}, testInfo) => {
  const project = await (
    await request.post("/api/projects", { data: { name: "本地旋律实验" } })
  ).json();
  const base = await (
    await request.post(`/api/projects/${project.id}/import`, {
      multipart: {
        file: {
          name: "原曲.wav",
          mimeType: "audio/wav",
          buffer: sineWav(220, 5),
        },
      },
    })
  ).json();
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "本地旋律实验" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "哼唱素材" }).click();
  const humBytes = sineWav(440, 3);
  await page.getByLabel("上传哼唱文件").setInputFiles({
    name: "我的哼唱.wav",
    mimeType: "audio/wav",
    buffer: humBytes,
  });
  await page.getByRole("button", { name: "保存并分析" }).click();
  await expect(
    page.getByRole("heading", { name: "我的哼唱.wav", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("img", { name: "哼唱音高曲线" })).toBeVisible();
  let state = await (await request.get("/api/state")).json();
  let p = state.projects.find((p: { id: string }) => p.id === project.id),
    hum = p.hums[0];
  expect(JSON.parse(hum.analysisJson).medianHz).toBeCloseTo(440, 0);
  const original = await request.get(`/api/hums/${hum.id}/audio?original=1`);
  expect(await original.body()).toEqual(humBytes);
  expect(hum.originalSha256).toBe(
    createHash("sha256").update(humBytes).digest("hex"),
  );
  expect(
    (
      await request.get(`/api/hums/${hum.id}/audio`, {
        headers: { Range: "bytes=0-43" },
      })
    ).status(),
  ).toBe(206);
  await page.getByLabel("裁剪首尾静音").uncheck();
  await page.getByRole("button", { name: "按左侧选项另存处理" }).click();
  await expect(
    page.getByRole("heading", { name: "我的哼唱.wav", exact: true }),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("hum-workspace.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "本地编辑" }).click();
  await page.getByLabel("原曲版本").selectOption(base.id);
  await page.getByLabel("替换素材").selectOption(`hum:${hum.id}`);
  await page.getByLabel("开始时间（秒）").fill("1");
  await page.getByLabel("结束时间（秒）").fill("2.5");
  await page.getByRole("button", { name: "替换并另存新版本" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "已保存新版本" }),
  ).toBeVisible({ timeout: 30000 });
  const compare = page.getByLabel("原曲与结果对比播放器");
  await compare.evaluate(async (audio: HTMLAudioElement) => {
    audio.currentTime = 1.2;
    await audio.play();
    audio.pause();
  });
  await page.getByRole("button", { name: "A · 原曲" }).click();
  await expect
    .poll(() =>
      compare.evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "试听选区", exact: true }).click();
  await expect
    .poll(() => compare.evaluate((audio: HTMLAudioElement) => audio.paused), {
      timeout: 8000,
    })
    .toBe(true);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("local-editor.png"),
    fullPage: true,
  });
  state = await (await request.get("/api/state")).json();
  p = state.projects.find((p: { id: string }) => p.id === project.id);
  const result = p.versions.find(
    (v: { sourceType: string }) => v.sourceType === "local_edit",
  );
  expect(result.parentVersionId).toBe(base.id);
  expect(result.implementation).toBe("local");
  expect(JSON.parse(result.paramsSnapshot).outsideRegionUnchanged).toBe(true);
  expect((await request.get(`/api/audio/${base.id}`)).status()).toBe(200);
  expect(p.versions.find((v: { id: string }) => v.id === base.id).sha256).toBe(
    base.sha256,
  );
  await page.reload();
  await page.getByRole("tab", { name: "哼唱素材" }).click();
  await expect(
    page.getByRole("heading", { name: "我的哼唱.wav", exact: true }),
  ).toHaveCount(2);
  const other = await (
    await request.post("/api/projects", { data: { name: "另一个项目" } })
  ).json();
  const illegal = await request.post(`/api/projects/${other.id}/edits`, {
    data: {
      baseVersionId: base.id,
      sourceType: "hum",
      sourceId: hum.id,
      startSec: 1,
      endSec: 2,
    },
  });
  expect(illegal.status()).toBe(400);
  const short = await request.post(`/api/projects/${project.id}/edits`, {
    data: {
      baseVersionId: base.id,
      sourceType: "hum",
      sourceId: hum.id,
      startSec: 0,
      endSec: 5,
    },
  });
  expect(short.status()).toBe(400);
});
test("浏览器虚拟麦克风录音可暂停、恢复、保存；未保存时阻止离开", async ({
  page,
  request,
}) => {
  await request.post("/api/projects", { data: { name: "录音测试" } });
  await page.goto("/");
  await page.getByRole("tab", { name: "哼唱素材" }).click();
  await page.getByRole("button", { name: "开始录音" }).click();
  await expect(page.getByRole("button", { name: "暂停录音" })).toBeVisible();
  // Wait on actual recording state instead of relying on a fixed sleep.
  await expect(page.locator(".recording-clock")).toContainText("0:01", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "暂停录音" }).click();
  await expect(page.getByRole("button", { name: "继续录音" })).toBeVisible();
  await page.getByRole("button", { name: "继续录音" }).click();
  await expect(page.locator(".recording-clock")).toContainText("0:02", {
    timeout: 10000,
  });
  await page.getByRole("button", { name: "停止录音" }).click();
  await expect(page.getByLabel("录音预览")).toBeVisible();
  await page.getByRole("tab", { name: "文字创作" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "请先停止录音" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "保存并分析" }).click();
  await expect(page.locator(".hum-card")).toHaveCount(1, { timeout: 30000 });
  await expect(page.getByLabel("录音预览")).toHaveCount(0);
  await page.getByRole("tab", { name: "文字创作" }).click();
  await expect(page.getByLabel("创作描述")).toBeVisible();
});
test("麦克风权限被拒绝仍可上传文件", async ({ page, request }) => {
  await request.post("/api/projects", { data: { name: "权限测试" } });
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("test denial", "NotAllowedError");
    };
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "哼唱素材" }).click();
  await page.getByRole("button", { name: "开始录音" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "麦克风权限被拒绝" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上传哼唱音频" }),
  ).toBeEnabled();
});
