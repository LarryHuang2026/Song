import { defineConfig } from "prisma/config";
import { config } from "./src/lib/config";
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: config.databaseUrl },
});
