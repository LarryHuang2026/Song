import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client";
import Sqlite from "better-sqlite3";
import path from "node:path";
import { config } from "./config";
const globalDb = globalThis as unknown as { studioDb?: PrismaClient };
function createDb() {
  const raw = new Sqlite(path.join(config.dataRoot, "studio.db"));
  raw.pragma("journal_mode = WAL");
  raw.pragma("busy_timeout = 5000");
  raw.close();
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3(
      { url: config.databaseUrl },
      { timestampFormat: "unixepoch-ms" },
    ),
  });
}
export const db = globalDb.studioDb ?? createDb();
if (process.env.NODE_ENV !== "production") globalDb.studioDb = db;
