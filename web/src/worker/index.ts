import { randomUUID } from "node:crypto";
import { db } from "../lib/db";
import { redact } from "../lib/domain";
import { processJob, recoverJobs } from "./engine";
const owner = randomUUID();
let stopping = false,
  lostLease = false;
const expired = () => new Date(Date.now() - 20000);
await db.workerState.upsert({
  where: { id: "main" },
  create: { id: "main", owner: "", heartbeatAt: new Date(0) },
  update: {},
});
const lease = await db.workerState.updateMany({
  where: { id: "main", heartbeatAt: { lt: expired() } },
  data: { owner, heartbeatAt: new Date() },
});
if (!lease.count) {
  console.error("已有 worker 正在运行；若刚刚停止，请等待 20 秒后重试。");
  await db.$disconnect();
  process.exit(1);
}
const heartbeat = setInterval(() => {
  db.workerState
    .updateMany({
      where: { id: "main", owner },
      data: { heartbeatAt: new Date() },
    })
    .then((result) => {
      if (!result.count) {
        lostLease = true;
        stopping = true;
      }
    })
    .catch(() => {
      lostLease = true;
      stopping = true;
    });
}, 3000);
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
try {
  await recoverJobs();
  console.log(
    "音乐 worker 已启动；真实生成请求不自动重试。Ctrl+C 将等待当前任务完成。",
  );
  while (!stopping) {
    const active = await db.generationJob.findFirst({
      where: { status: { in: ["uploading", "running", "downloading"] } },
      orderBy: { createdAt: "asc" },
    });
    const job = active
      ? !active.nextPollAt || active.nextPollAt.getTime() <= Date.now()
        ? active
        : null
      : await db.generationJob.findFirst({
          where: { status: "queued" },
          orderBy: { createdAt: "asc" },
        });
    if (job) {
      try {
        await processJob(job.id);
      } catch (e) {
        console.error(
          "任务处理失败：",
          redact(e instanceof Error ? e.message : e),
        );
        await recoverJobs();
        await new Promise((r) => setTimeout(r, 3000));
      }
    } else await new Promise((r) => setTimeout(r, 1000));
  }
} finally {
  clearInterval(heartbeat);
  if (!lostLease)
    await db.workerState.updateMany({
      where: { id: "main", owner },
      data: { heartbeatAt: new Date(0) },
    });
  await db.$disconnect();
}
