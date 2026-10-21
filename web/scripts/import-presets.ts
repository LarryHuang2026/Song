import path from "node:path";
import {
  importProjectPresets,
  readProjectPresets,
} from "../src/lib/project-presets";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check") || args.length > 1) {
  console.error("用法：node scripts/import-presets.mjs [--check]");
  process.exit(1);
}
const root =
  process.env.MUSIC_PROJECT_ROOT || path.resolve(process.cwd(), "..");
try {
  const presets = await readProjectPresets(path.join(root, "presets/projects"));
  if (args.includes("--check")) {
    console.log(`预设格式检查通过：${presets.length} 份；未写入数据库。`);
  } else {
    const { db } = await import("../src/lib/db");
    try {
      const results = await importProjectPresets(db, presets);
      for (const result of results)
        console.log(
          `${result.imported ? "已导入" : "已导入过，保留本机草稿"}：${result.name}`,
        );
      console.log(
        "完成。刷新工作台查看；未提交生成任务。更新后的预设会另建副本。",
      );
    } finally {
      await db.$disconnect();
    }
  }
} catch {
  console.error(
    "预设导入失败。请检查 presets/projects 中的 JSON，先安装依赖并执行数据库迁移（npm --prefix web run db:migrate）。",
  );
  process.exitCode = 1;
}
