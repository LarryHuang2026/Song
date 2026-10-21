import { test, expect } from "@playwright/test";
function wav() {
  const count = 8000 * 12,
    bytes = Buffer.alloc(44 + count * 2);
  bytes.write("RIFF");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    bytes.writeInt16LE(
      Math.round(9000 * Math.sin((2 * Math.PI * 220 * i) / 8000)),
      44 + i * 2,
    );
  return bytes;
}
test("AI 草稿独立保存：切换功能、项目和刷新保留歌词、选区和未完成参数", async ({
  page,
  request,
}) => {
  const p = await (
    await request.post("/api/projects", { data: { name: "AI 草稿项目 A" } })
  ).json();
  const version = await (
    await request.post(`/api/projects/${p.id}/import`, {
      multipart: {
        file: { name: "区间测试.wav", mimeType: "audio/wav", buffer: wav() },
      },
    })
  ).json();
  await page.goto("/");
  await page.getByRole("tab", { name: "AI 哼唱成曲", exact: true }).click();
  await page.getByLabel("作品标题").fill("哼唱草稿标题");
  await page.getByLabel("音乐风格", { exact: true }).fill("哼唱草稿风格");
  await page.getByLabel("AI 模型").selectOption("suno-v6-wild");
  await page.getByLabel("歌词（可留空）", { exact: true }).fill("哼唱草稿歌词");
  await page.getByLabel("创作要求").fill("哼唱独立创作要求");
  await page.getByLabel("参考音频影响权重").press("Home");
  await page.getByLabel("参考音频影响权重").press("ArrowRight");
  await page.getByLabel("生成纯音乐").check();
  // Switch immediately: navigation must flush the latest fields, even before debounce.
  await page.getByRole("tab", { name: "AI 段落重写", exact: true }).click();
  await expect(page.getByLabel("作品标题")).toHaveValue("AI 草稿项目 A");
  await page.getByLabel("原曲版本").selectOption(version.id);
  await page.getByLabel("作品标题").fill("重写草稿标题");
  await page.getByLabel("音乐风格", { exact: true }).fill("爵士");
  await page.getByLabel("整首歌词上下文").fill("独立的完整歌词");
  await page.getByLabel("选区前后歌词（可留空）").fill("选区上下文");
  await page.getByLabel("替换段的新歌词").fill("替换段新词");
  await page.getByLabel("AI 开始时间（秒）").fill("1.25");
  await page.getByLabel("AI 结束时间（秒）").fill("5.75");
  await page.getByLabel("衔接淡化（毫秒）").fill("80");
  await page.getByRole("tab", { name: "AI 哼唱成曲", exact: true }).click();
  await expect(page.getByLabel("作品标题")).toHaveValue("哼唱草稿标题");
  await expect(page.getByLabel("歌词（可留空）", { exact: true })).toHaveValue(
    "哼唱草稿歌词",
  );
  await expect(page.getByLabel("生成纯音乐")).toBeChecked();
  await expect(page.getByLabel("AI 模型")).toHaveValue("suno-v6-wild");
  await expect(page.getByLabel("参考音频影响权重")).toHaveValue("0.05");
  // Incomplete drafts must still be saved; generation validation is separate.
  await page.getByLabel("作品标题").fill("");
  await page.getByLabel("音乐风格", { exact: true }).fill("");
  await page.getByRole("tab", { name: "文字创作", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "创作设定", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "AI 哼唱成曲", exact: true }).click();
  await expect(page.getByLabel("作品标题")).toHaveValue("");
  await expect(page.getByLabel("音乐风格", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("创作要求")).toHaveValue("哼唱独立创作要求");
  await page.getByRole("tab", { name: "AI 段落重写", exact: true }).click();
  await expect(page.getByLabel("原曲版本")).toHaveValue(version.id);
  await expect(page.getByLabel("AI 开始时间（秒）")).toHaveValue("1.25");
  await expect(page.getByLabel("AI 结束时间（秒）")).toHaveValue("5.75");
  await expect(page.getByLabel("衔接淡化（毫秒）")).toHaveValue("80");
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("AI 草稿项目 B");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await expect(page.getByLabel("作品标题")).toHaveValue("AI 草稿项目 B");
  await page.getByLabel("作品标题").fill("B 独立标题");
  await page
    .locator(".project-item")
    .filter({ hasText: "AI 草稿项目 A" })
    .click();
  await expect(page.getByLabel("作品标题")).toHaveValue("重写草稿标题");
  const state = await (await request.get("/api/state")).json();
  const a = state.projects.find((v: { id: string }) => v.id === p.id);
  expect(JSON.parse(a.aiCoverDraft).lyrics).toBe("哼唱草稿歌词");
  expect(JSON.parse(a.aiRewriteDraft).infillLyrics).toBe("替换段新词");
  expect(a.jobs).toHaveLength(0);
});

test("保存失败保留输入并阻止离开，恢复后可重试；归档项目草稿禁止写入", async ({
  page,
  request,
}) => {
  const p = await (
    await request.post("/api/projects", { data: { name: "保存失败回归" } })
  ).json();
  await page.goto("/");
  await page.getByRole("tab", { name: "AI 哼唱成曲", exact: true }).click();
  await page.route(`**/api/projects/${p.id}/ai-draft`, (route) =>
    route.fulfill({ status: 503, json: { error: "模拟草稿保存失败" } }),
  );
  await page.getByLabel("作品标题").fill("网络中断时保留的标题");
  await expect(page.getByLabel("AI 草稿保存状态")).toHaveText("AI 草稿未保存");
  await page.getByRole("tab", { name: "文字创作", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "AI 哼唱成曲", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("作品标题")).toHaveValue("网络中断时保留的标题");
  await expect(
    page.getByText("模拟草稿保存失败", { exact: true }),
  ).toBeVisible();
  await page.unroute(`**/api/projects/${p.id}/ai-draft`);
  await page.getByRole("button", { name: "保存 AI 草稿", exact: true }).click();
  await expect(page.getByLabel("AI 草稿保存状态")).toHaveText("AI 草稿已保存");
  await page.getByRole("tab", { name: "文字创作", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "创作设定", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "AI 哼唱成曲", exact: true }).click();
  await expect(page.getByLabel("作品标题")).toHaveValue("网络中断时保留的标题");
  const state = await (await request.get("/api/state")).json();
  const saved = JSON.parse(
    state.projects.find((v: { id: string }) => v.id === p.id).aiCoverDraft,
  );
  await request.patch(`/api/projects/${p.id}`, { data: { archived: true } });
  expect(
    (
      await request.post(`/api/projects/${p.id}/ai-draft`, {
        data: { kind: "hum_cover", draft: saved },
      })
    ).status(),
  ).toBe(409);
});
