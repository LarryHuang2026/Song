import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink, link, realpath } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "./config";
const exec = promisify(execFile);
const probeSchema = z.object({
  streams: z.array(
    z.object({
      sample_rate: z.coerce.number().positive(),
      channels: z.number().positive(),
    }),
  ),
  format: z.object({
    duration: z.coerce.number().positive().max(3600).optional(),
  }),
});
export async function assetPath(relative: string) {
  const candidate = path.resolve(config.dataRoot, relative);
  if (!candidate.startsWith(config.dataRoot + path.sep))
    throw new Error("非法音频路径");
  // Final files are created by this app; also reject symlink escapes on reads.
  const actual = await realpath(candidate);
  if (!actual.startsWith((await realpath(config.dataRoot)) + path.sep))
    throw new Error("非法音频路径");
  return actual;
}
export async function inspectAudio(file: string) {
  const { stdout } = await exec(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=sample_rate,channels:format=duration",
      "-of",
      "json",
      file,
    ],
    { timeout: 60000 },
  );
  const info = probeSchema.parse(JSON.parse(stdout));
  if (!info.streams.length) throw new Error("文件没有音频轨道");
  const decoded = await exec(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "1000",
      "-t",
      "3600.001",
      "-f",
      "f32le",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
  );
  const buffer = decoded.stdout as Buffer;
  const count = Math.floor(buffer.length / 4);
  if (!count || count > 3600 * 1000)
    throw new Error("音频时长需在 0–3600 秒之间");
  const peaks = Array.from({ length: 240 }, (_, i) => {
    let max = 0;
    for (
      let j = Math.floor((i * count) / 240);
      j < Math.floor(((i + 1) * count) / 240);
      j++
    )
      max = Math.max(max, Math.abs(buffer.readFloatLE(j * 4)));
    return Math.round(Math.min(max, 1) * 10000) / 10000;
  });
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return {
    durationSec: info.format.duration ?? count / 1000,
    sampleRate: info.streams[0].sample_rate,
    channels: info.streams[0].channels,
    sha256: hash.digest("hex"),
    peaks: JSON.stringify(peaks),
  };
}
export async function saveAudio(bytes: Buffer, ext: string) {
  await mkdir(path.join(config.dataRoot, "audio"), { recursive: true });
  const relative = `audio/${randomUUID()}.${ext}`;
  const temp = path.join(config.dataRoot, relative + ".part");
  try {
    await writeFile(temp, bytes, { flag: "wx" });
    const info = await inspectAudio(temp);
    await publishFile(temp, relative);
    return { assetPath: relative, ...info };
  } catch (e) {
    await unlink(temp).catch(() => {});
    throw e;
  }
}
export async function publishFile(temp: string, relative: string) {
  const target = path.join(config.dataRoot, relative);
  await link(temp, target); // Atomic, refuses overwrite, including concurrent writers.
  await unlink(temp);
}
export function makeDemoWav(index: number): Buffer {
  const rate = 22050,
    seconds = 8,
    count = rate * seconds;
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + count * 2, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(count * 2, 40);
  const notes = index
    ? [329.63, 392, 493.88, 440, 392, 329.63, 293.66, 261.63]
    : [261.63, 329.63, 392, 523.25, 440, 392, 329.63, 261.63];
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      local = t % 1;
    const envelope =
      Math.min(local * 25, 1) *
      Math.max(0, 1 - local) *
      Math.min(t, seconds - t, 1);
    const freq = notes[Math.floor(t) % notes.length];
    buffer.writeInt16LE(
      Math.round(
        (11000 *
          envelope *
          (Math.sin(2 * Math.PI * freq * t) +
            0.2 * Math.sin(4 * Math.PI * freq * t))) /
          1.2,
      ),
      44 + i * 2,
    );
  }
  return buffer;
}
