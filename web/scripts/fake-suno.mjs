// Local protocol fixture only. Never produces AI music or talks to an external service.
import http from "node:http";
import { randomUUID } from "node:crypto";
const key = "test-suno-e2e-secret",
  songs = new Map();
const stats = {
  uploads: 0,
  covers: 0,
  replacements: 0,
  queries: 0,
  lastCover: null,
  lastReplace: null,
};
const rate = 44100,
  count = rate * 8,
  wav = Buffer.alloc(44 + count * 2);
wav.write("RIFF");
wav.writeUInt32LE(36 + count * 2, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(count * 2, 40);
for (let i = 0; i < count; i++)
  wav.writeInt16LE(
    Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 9000),
    44 + 2 * i,
  );
const server = http.createServer(async (req, res) => {
  const json = (body, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    if (req.url === "/__stats") return json(stats);
    if (req.url.startsWith("/media/")) {
      if (req.headers.authorization)
        return json(
          { error: "credentials must not be forwarded to media" },
          400,
        );
      res.writeHead(200, {
        "Content-Type": "audio/wav",
        "Content-Length": wav.length,
      });
      return res.end(wav);
    }
    if (req.headers.authorization !== `Bearer ${key}`)
      return json({ error: "invalid key" }, 401);
    if (req.url === "/api/user/balance")
      return json({
        success: true,
        data: { balance: { effective_amount: 10 } },
      });
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (req.url === "/api/music/upload-source") {
      const form = await new Request("http://127.0.0.1:8198/upload", {
        method: "POST",
        headers: req.headers,
        body: bytes,
      }).formData();
      if (!(form.get("file") instanceof File))
        return json({ error: "multipart file required" }, 400);
      stats.uploads++;
      return json({ clip_id: `source-${randomUUID()}`, status: "complete" });
    }
    const body = JSON.parse(bytes.toString());
    if (
      [
        "/api/music/generate-from-source",
        "/api/music/replace-section",
      ].includes(req.url)
    ) {
      if (req.url.endsWith("generate-from-source")) {
        if (!body.sourceClipId) return json({}, 400);
        stats.covers++;
        stats.lastCover = body;
      } else {
        if (!body.audioId || body.endSeconds - body.startSeconds < 2)
          return json({}, 400);
        stats.replacements++;
        stats.lastReplace = body;
      }
      const clips = Array.from({ length: 2 }, () => {
        const song_id = `song-${randomUUID()}`;
        songs.set(song_id, 0);
        return { song_id, status: "pending" };
      });
      return json({ code: 200, data: { clips } });
    }
    if (req.url === "/api/music/query") {
      stats.queries++;
      return json(
        body.song_ids
          .split(",")
          .filter((id) => songs.has(id))
          .map((id) => {
            const queries = songs.get(id) + 1;
            songs.set(id, queries);
            return {
              song_id: id,
              status: queries > 1 ? "completed" : "pending",
              audio_url:
                queries > 1 ? `http://127.0.0.1:8198/media/${id}.wav` : "",
            };
          }),
      );
    }
    json({}, 404);
  } catch {
    json({ error: "fixture request failed" }, 400);
  }
});
server.listen(8198, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
