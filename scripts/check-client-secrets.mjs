import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(root, ".env.local");
try { process.loadEnvFile(envFile); } catch {}
const keys = [process.env.FLUXPORT_API_KEY, process.env.SUNO_API_KEY].filter(Boolean);
try { const saved = JSON.parse(readFileSync(path.join(path.resolve(root, process.env.MUSIC_DATA_ROOT || "data"), "provider-settings.json"), "utf8")); if (saved.key) keys.push(saved.key); } catch {}
if (!keys.length) { console.log("未配置 Key，跳过实际值扫描。"); process.exit(0); }
function scan(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(file);
    else { const bytes = readFileSync(file); if (keys.some(key => bytes.includes(Buffer.from(key)))) throw new Error("前端构建产物发现服务端 Key（已隐藏具体值）"); }
  }
}
scan(path.join(root, "web/.next/static"));
console.log("前端构建产物扫描通过：未包含实际 API Key。");
