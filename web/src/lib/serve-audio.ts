import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { assetPath } from "./audio";
export async function serveAudio(
  request: NextRequest,
  audio: { id: string; assetPath: string; mimeType: string; label: string },
) {
  const file = await assetPath(audio.assetPath),
    { size } = await stat(file);
  const headers: Record<string, string> = {
    "Content-Type": audio.mimeType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  };
  const ext = audio.assetPath.split(".").at(-1);
  if (request.nextUrl.searchParams.get("download") === "1")
    headers["Content-Disposition"] =
      `attachment; filename="${audio.id}.${ext}"; filename*=UTF-8''${encodeURIComponent(audio.label)}.${ext}`;
  const range = request.headers.get("range");
  let start = 0,
    end = size - 1;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(Number(match[2]), size - 1);
    }
    if (
      start >= size ||
      end < start ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end)
    )
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  return new Response(
    Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream,
    { status: range ? 206 : 200, headers },
  );
}
