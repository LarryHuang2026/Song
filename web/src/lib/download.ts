import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { open, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config";
import { inspectAudio, publishFile } from "./audio";
const MAX_BYTES = 100 * 1024 * 1024;
export async function validateRemoteUrl(raw: string) {
  const url = new URL(raw);
  if (
    process.env.MUSIC_E2E === "1" &&
    process.env.SUNO_API_BASE_URL &&
    url.origin === new URL(process.env.SUNO_API_BASE_URL).origin &&
    url.hostname === "127.0.0.1" &&
    url.pathname.startsWith("/media/")
  )
    return url;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("音频链接不安全");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => {
      if (address.includes(":")) return !/^[23][0-9a-f]{3}:/i.test(address); // public IPv6 only
      const [a, b] = address.split(".").map(Number);
      return (
        a === 0 ||
        a === 10 ||
        a === 127 ||
        a >= 224 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 100 && b >= 64 && b <= 127)
      );
    })
  )
    throw new Error("音频链接不能指向本地或私有网络");
  return url;
}
export async function downloadAudio(
  raw: string,
  onProgress: (received: number, total: number | null) => Promise<void>,
) {
  const signal = AbortSignal.timeout(900000);
  let url = raw;
  let response: Response | undefined;
  for (let i = 0; i <= 4; i++) {
    await validateRemoteUrl(url);
    response = await fetch(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location || i === 4) throw new Error("音频链接重定向失败");
      url = new URL(location, url).href;
    } else break;
  }
  if (!response?.ok || !response.body)
    throw new Error(`音频下载失败（HTTP ${response?.status}），可只重试下载`);
  const type = response.headers.get("content-type") || "";
  if (!/audio|octet-stream/i.test(type)) {
    await response.body.cancel();
    throw new Error("下载结果不是音频文件");
  }
  const ext = /wav/i.test(type)
    ? "wav"
    : /flac/i.test(type)
      ? "flac"
      : /mp4|m4a/i.test(type)
        ? "m4a"
        : "mp3";
  const mimeType = {
    wav: "audio/wav",
    flac: "audio/flac",
    m4a: "audio/mp4",
    mp3: "audio/mpeg",
  }[ext];
  const total = Number(response.headers.get("content-length")) || null;
  if (total && total > MAX_BYTES) {
    await response.body.cancel();
    throw new Error("音频文件超过 100 MB 限制");
  }
  await mkdir(path.join(config.dataRoot, "audio"), { recursive: true });
  const relative = `audio/${randomUUID()}.${ext}`,
    temp = path.join(config.dataRoot, relative + ".part");
  const handle = await open(temp, "wx");
  let received = 0,
    last = 0;
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      if (received > MAX_BYTES) throw new Error("音频文件超过 100 MB 限制");
      await handle.writeFile(chunk);
      if (Date.now() - last > 1000) {
        await onProgress(received, total);
        last = Date.now();
      }
    }
    await handle.close();
    if (!received || (total && total !== received))
      throw new Error("音频下载不完整");
    const info = await inspectAudio(temp);
    await publishFile(temp, relative);
    await onProgress(received, total);
    return { assetPath: relative, mimeType, ...info };
  } catch (e) {
    await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw e;
  }
}
