import { test, expect } from "@playwright/test";
test("扩展创作选项、年轻声线及自定义声线可保存恢复", async ({
  page,
  request,
}, testInfo) => {
  const p = await (
    await request.post("/api/projects", { data: { name: "丰富创作选项回归" } })
  ).json();
  await page.goto("/");
  await expect(page.getByLabel("音乐模型", { exact: true })).toHaveValue(
    "suno-v6",
  );
  for (const model of [
    "suno-v5",
    "suno-v5.5",
    "suno-v6-mini",
    "suno-v6-wild",
    "suno-v6",
  ])
    await page.getByLabel("音乐模型", { exact: true }).selectOption(model);
  await page.getByLabel("创作描述").fill("轻快梦幻的青春流行歌");
  await page.getByLabel("歌词", { exact: true }).fill("长".repeat(3100));
  await expect(page.getByText(/超过 3000/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "体验一次创作", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("歌词", { exact: true }).fill("原创的短歌词");
  const style = page.getByRole("group", { name: "音乐风格常用选项" });
  await page.getByLabel("音乐风格", { exact: true }).fill("自定义融合风格");
  await style.getByRole("button", { name: /更多音乐风格/ }).click();
  await style.getByRole("button", { name: "City Pop", exact: true }).click();
  await style.getByRole("button", { name: "R&B", exact: true }).click();
  await style
    .getByRole("button", { name: "收起音乐风格", exact: true })
    .click();
  await expect(
    style.getByRole("button", { name: "City Pop", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("音乐风格", { exact: true })).toHaveValue(
    "自定义融合风格、City Pop、R&B",
  );
  const mood = page.getByRole("group", { name: "情绪氛围常用选项" });
  await mood.getByRole("button", { name: /更多情绪氛围/ }).click();
  await mood.getByRole("button", { name: "青春", exact: true }).click();
  await mood.getByRole("button", { name: "梦幻", exact: true }).click();
  await mood.getByRole("button", { name: "收起情绪氛围", exact: true }).click();
  const instruments = page.getByRole("group", { name: "乐器偏好常用选项" });
  await instruments.getByRole("button", { name: /更多乐器偏好/ }).click();
  await instruments.getByRole("button", { name: "竖琴", exact: true }).click();
  await instruments.getByRole("button", { name: "手碟", exact: true }).click();
  await instruments
    .getByRole("button", { name: "收起乐器偏好", exact: true })
    .click();
  await expect(page.getByLabel("演唱声音").locator("option")).toHaveCount(22);
  await page
    .getByRole("group", { name: "声线快捷选择" })
    .getByRole("button", { name: "清甜少女感女声", exact: true })
    .click();
  await expect(page.getByLabel("演唱声音")).toHaveValue("清甜少女感女声");
  await expect(page.locator(".vocal-profile-note")).toContainText("年轻成人");
  await page.getByText("查看实际发送的提示词", { exact: true }).click();
  await expect(page.locator(".prompt-preview pre")).toContainText(
    "youthful young-adult tone",
  );
  await page.getByLabel("演唱声音").selectOption("女声二重唱");
  await expect(page.locator(".prompt-preview pre")).toContainText(
    "female duet",
  );
  await expect(page.locator(".prompt-preview pre")).not.toContainText("solo");
  await page.getByLabel("演唱声音").selectOption("__custom__");
  await expect(
    page.getByRole("button", { name: "体验一次创作", exact: true }),
  ).toBeDisabled();
  const custom = "年轻成人的清亮中性声，气息轻柔，咬字自然";
  await page.getByLabel("自定义声线描述").fill(custom);
  await expect(page.locator(".prompt-preview pre")).toContainText(custom);
  await page.getByLabel("纯音乐", { exact: true }).check();
  await expect(page.getByLabel("自定义声线描述")).toBeDisabled();
  await page.getByLabel("纯音乐", { exact: true }).uncheck();
  await expect(page.getByLabel("自定义声线描述")).toHaveValue(custom);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "草稿已保存", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("音乐模型", { exact: true })).toHaveValue(
    "suno-v6",
  );
  await expect(page.getByLabel("演唱声音")).toHaveValue("__custom__");
  await expect(page.getByLabel("自定义声线描述")).toHaveValue(custom);
  await expect(page.getByLabel("乐器偏好", { exact: true })).toHaveValue(
    "竖琴、手碟",
  );
  await expect(page.getByLabel("情绪氛围", { exact: true })).toHaveValue(
    "青春、梦幻",
  );
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.screenshot({
    path: testInfo.outputPath("creative-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await style.getByRole("button", { name: /更多音乐风格/ }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("creative-mobile.png"),
    fullPage: true,
  });
  const state = await (await request.get("/api/state")).json();
  expect(
    state.projects.find((project: { id: string }) => project.id === p.id).jobs,
  ).toHaveLength(0);
});
