import type { NextConfig } from "next";
const config: NextConfig = {
  distDir: process.env.MUSIC_E2E === "1" ? ".next-e2e" : ".next",
  devIndicators: false,
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
  ],
};
export default config;
