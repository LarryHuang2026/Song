import { config as dotenv } from "dotenv";
import path from "node:path";
import { mkdirSync } from "node:fs";
export const root =
  process.env.MUSIC_PROJECT_ROOT ||
  path.resolve(
    process.cwd(),
    path.basename(process.cwd()) === "web" ? ".." : ".",
  );
dotenv({ path: path.join(root, ".env.local"), quiet: true });
const dataRoot = path.resolve(root, process.env.MUSIC_DATA_ROOT || "data");
mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
export const config = {
  audioServiceUrl: process.env.AUDIO_SERVICE_URL || "http://127.0.0.1:8100",
  dataRoot,
  databaseUrl: `file:${path.join(dataRoot, "studio.db")}`,
  apiKey: process.env.FLUXPORT_API_KEY || "",
  baseUrl: (
    process.env.FLUXPORT_BASE_URL || "https://api.uselg.top/v1"
  ).replace(/\/+$/, ""),
};
