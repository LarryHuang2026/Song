import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Sqlite from "better-sqlite3";
import { afterAll, beforeAll, expect, it } from "vitest";

const dataRoot = mkdtempSync(path.join(tmpdir(), "song-preset-test-"));
process.env.MUSIC_DATA_ROOT = dataRoot;
const { db } = await import("../src/lib/db");
const { readProjectPresets, importProjectPresets, projectPresetSchema } =
  await import("../src/lib/project-presets");
const presets = await readProjectPresets(path.resolve("../presets/projects"));
beforeAll(() => {
  const raw = new Sqlite(path.join(dataRoot, "studio.db"));
  for (const entry of readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name)))
    raw.exec(
      readFileSync(`prisma/migrations/${entry.name}/migration.sql`, "utf8"),
    );
  raw.close();
});
afterAll(async () => {
  await db.$disconnect();
  await rm(dataRoot, { recursive: true, force: true });
});

it("导入完整歌词与参数，不创建收费任务；重复导入保留本机修改和归档", async () => {
  const results = await importProjectPresets(db, presets);
  expect(results.every((result) => result.imported)).toBe(true);
  for (const [index, result] of results.entries()) {
    const project = await db.project.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(project.lyricsDraft).toBe(presets[index].lyricsDraft);
    expect(JSON.parse(project.promptDraft)).toEqual(presets[index].promptDraft);
  }
  const id = results[0].id;
  const archivedAt = new Date();
  await db.project.update({
    where: { id },
    data: {
      name: "本机改名",
      lyricsDraft: "本机新歌词",
      promptDraft: "{}",
      archivedAt,
    },
  });
  const again = await importProjectPresets(db, presets);
  expect(again.every((result) => !result.imported)).toBe(true);
  expect(await db.project.count()).toBe(presets.length);
  expect(await db.project.findUniqueOrThrow({ where: { id } })).toMatchObject({
    name: "本机改名",
    lyricsDraft: "本机新歌词",
    promptDraft: "{}",
    archivedAt,
  });
  expect(await db.generationJob.count()).toBe(0);
});

it("更新预设另建副本，保留旧副本；相同字段不同键顺序不会重复导入", async () => {
  const changed = { ...presets[0], lyricsDraft: "更新后的仓库歌词" };
  const [result] = await importProjectPresets(db, [changed]);
  expect(result.imported).toBe(true);
  const reordered = Object.fromEntries(Object.entries(changed).reverse());
  const [again] = await importProjectPresets(db, [
    projectPresetSchema.parse(reordered),
  ]);
  expect(again).toMatchObject({ id: result.id, imported: false });
  expect(await db.project.count()).toBe(presets.length + 1);
  expect(await db.generationJob.count()).toBe(0);
});

it("拒绝密钥及本地素材字段，整批校验失败不留下部分项目", async () => {
  expect(() =>
    projectPresetSchema.parse({ ...presets[0], apiKey: "not-a-real-key" }),
  ).toThrow();
  expect(() =>
    projectPresetSchema.parse({
      ...presets[0],
      promptDraft: { ...presets[0].promptDraft, parentVersionId: "local-only" },
    }),
  ).toThrow();
  const before = await db.project.count();
  await expect(
    importProjectPresets(db, [
      { ...presets[0], lyricsDraft: "不应写入" },
      { ...presets[1], schemaVersion: 2 } as never,
    ]),
  ).rejects.toThrow();
  expect(await db.project.count()).toBe(before);
  await expect(
    importProjectPresets(db, [presets[0], presets[0]]),
  ).rejects.toThrow("预设 key 重复");
});
