import { test, expect } from "@playwright/test";

test("女声与描述冲突时拦截 → 清除冲突 → 预览与保存 → AI 运行状态计数", async ({
  page,
  request,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("女声冲突回归");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .getByLabel("创作描述")
    .fill(
      "Mandarin retro pop, mellow male baritone vocal, warm acoustic guitar",
    );
  await page.getByLabel("演唱声音").selectOption("清澈女声");
  await expect(page.getByText("演唱要求有冲突", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "体验一次创作", exact: true }),
  ).toBeDisabled();
  const state = await (await request.get("/api/state")).json();
  const project = state.projects.find(
    (p: { name: string }) => p.name === "女声冲突回归",
  );
  const response = await request.post(`/api/projects/${project.id}/jobs`, {
    data: {
      clientRequestId: crypto.randomUUID(),
      provider: "mock",
      description: "male baritone vocal",
      vocal: "清澈女声",
    },
  });
  expect(response.status()).toBe(400);
  expect((await response.json()).error).toContain("冲突");
  await page
    .getByRole("button", { name: "清除冲突声线描述", exact: true })
    .click();
  await expect(page.getByLabel("创作描述")).not.toHaveValue(/male baritone/);
  await expect(page.getByLabel("创作描述")).toHaveValue(
    /Mandarin retro pop.*warm acoustic guitar/,
  );
  await expect(page.getByText("演唱要求有冲突", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "体验一次创作", exact: true }),
  ).toBeEnabled();
  await page.getByText("查看实际发送的提示词", { exact: true }).click();
  await expect(page.locator(".prompt-preview pre")).toContainText(
    "female solo lead vocals",
  );
  await expect(page.locator(".prompt-preview pre")).not.toContainText(
    "male baritone",
  );
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("演唱声音")).toHaveValue("清澈女声");
  await expect(page.getByLabel("创作描述")).not.toHaveValue(/male baritone/);
  await page.screenshot({
    path: testInfo.outputPath("vocal-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("vocal-mobile.png"),
    fullPage: true,
  });

  await page.route("**/api/state*", async (route) => {
    const response = await route.fetch();
    const current = await response.json();
    const p = current.projects.find((p: { id: string }) => p.id === project.id);
    if (p)
      p.jobs.unshift({
        id: "preview-ai-running",
        projectId: p.id,
        status: "running",
        provider: "suno-api",
        model: "suno-v6",
        requestParams: JSON.stringify({ kind: "hum_cover" }),
        createdAt: new Date().toISOString(),
        errorMessage: null,
        outputs: [],
      });
    await route.fulfill({ response, json: current });
  });
  await page.reload();
  await expect(page.locator(".orange-count")).toHaveText("1");
  await page.getByRole("button", { name: "生成记录" }).click();
  await expect(page.getByText("AI 正在创作", { exact: true })).toBeVisible();
  await expect(page.locator(".status-running .spin")).toHaveCount(1);
});
