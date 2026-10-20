import { test, expect } from "@playwright/test";
test("创建 → 保存草稿 → 演示生成 → 试听 → 选定 → 下载/导入 → 刷新 → 归档恢复", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("回家的路");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page.getByRole("heading", { name: "回家的路" })).toBeVisible();
  await page.getByLabel("创作描述").fill("温暖的钢琴曲，傍晚回家的感觉");
  await page
    .getByLabel("歌词", { exact: true })
    .fill("[主歌]\n路灯亮起来，你还在等我");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.reload();
  await expect(page.getByLabel("创作描述")).toHaveValue(
    "温暖的钢琴曲，傍晚回家的感觉",
  );
  await page.getByRole("button", { name: "体验一次创作" }).click();
  await expect(page.getByText("已完成", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "试听作品" }).click();
  await expect(page.locator("audio")).toHaveCount(2);
  const firstAudio = page.locator("audio").first();
  await firstAudio.evaluate(async (audio: HTMLAudioElement) => {
    await audio.play();
  });
  await expect
    .poll(() => firstAudio.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThan(0);
  const secondAudio = page.locator("audio").nth(1);
  await secondAudio.evaluate(async (audio: HTMLAudioElement) => {
    await audio.play();
  });
  await expect
    .poll(() => firstAudio.evaluate((a: HTMLAudioElement) => a.paused))
    .toBe(true);
  await page.getByRole("button", { name: "选用此版本" }).first().click();
  await expect(page.getByText("选定版本", { exact: true })).toBeVisible();
  const state = await (await request.get("/api/state")).json();
  const p = state.projects[0],
    version = p.versions[0];
  const full = await request.get(`/api/audio/${version.id}`);
  expect(full.status()).toBe(200);
  const range = await request.get(`/api/audio/${version.id}`, {
    headers: { Range: "bytes=0-43" },
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(44);
  expect((await range.body()).subarray(0, 4).toString()).toBe("RIFF");
  expect(
    (
      await request.get(`/api/audio/${version.id}`, {
        headers: { Range: "bytes=999999999-" },
      })
    ).status(),
  ).toBe(416);
  await expect(
    page.getByText("合成测试音频，无人声", { exact: true }),
  ).toHaveCount(2);
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("studio-desktop.png"),
    fullPage: true,
  });
  await page.getByLabel("导入音频文件").setInputFiles({
    name: "我的录音.wav",
    mimeType: "audio/wav",
    buffer: await full.body(),
  });
  await expect(
    page.getByRole("heading", { name: "我的录音.wav" }),
  ).toBeVisible();
  const afterImport = await (await request.get("/api/state")).json();
  const imported = afterImport.projects[0].versions.find(
    (v: { sourceType: string }) => v.sourceType === "import",
  );
  expect(imported.sha256).toBe(version.sha256);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "回家的路" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("studio-mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.reload();
  await expect(page.getByText("选定版本", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "归档项目", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "回家的路" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await expect(page.getByRole("heading", { name: "回家的路" })).toBeVisible();
  await page.getByRole("button", { name: "恢复项目", exact: true }).click();
  expect(
    (await (await request.get("/api/state")).json()).projects.some(
      (item: { id: string }) => item.id === p.id,
    ),
  ).toBe(true);
});
test("本机 API 拒绝跨站请求，重复提交保持同一个任务", async ({ request }) => {
  expect(
    (
      await request.post("/api/projects", {
        data: { name: "恶意跨站" },
        headers: { Origin: "https://evil.example" },
      })
    ).status(),
  ).toBe(403);
  const p = await (
    await request.post("/api/projects", { data: { name: "幂等检查" } })
  ).json();
  const payload = {
    description: "测试歌曲",
    provider: "mock",
    clientRequestId: crypto.randomUUID(),
  };
  const first = await request.post(`/api/projects/${p.id}/jobs`, {
    data: payload,
  });
  const second = await request.post(`/api/projects/${p.id}/jobs`, {
    data: payload,
  });
  expect(first.status()).toBe(202);
  expect(second.status()).toBe(202);
  expect((await first.json()).id).toBe((await second.json()).id);
  expect(
    (
      await request.post(`/api/projects/${p.id}/jobs`, {
        data: { ...payload, description: "另一个请求" },
      })
    ).status(),
  ).toBe(409);
});
test("从归档页创建新项目会进入创作空间，并可重命名", async ({
  page,
  request,
}) => {
  const archived = await (
    await request.post("/api/projects", { data: { name: "归档来源" } })
  ).json();
  await request.patch(`/api/projects/${archived.id}`, {
    data: { archived: true },
  });
  await page.goto("/");
  await page.getByRole("button", { name: "已归档", exact: true }).click();
  await expect(page.getByRole("heading", { name: "归档来源" })).toBeVisible();
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("新的灵感");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page.getByRole("heading", { name: "新的灵感" })).toBeVisible();
  await expect(page.getByLabel("创作描述")).toBeEnabled();
  await page.getByRole("button", { name: "重命名项目" }).click();
  await page.getByLabel("项目名称").fill("新的夏天");
  await page.getByRole("button", { name: "保存名称" }).click();
  await expect(page.getByRole("heading", { name: "新的夏天" })).toBeVisible();
});
