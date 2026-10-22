// The upstream stream contains text links and heartbeat comments, not audio.
// Never treat an HTTP 200 or a lone [DONE] as a completed generation.
export async function readMusicStream(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("空事件流");
  const decoder = new TextDecoder();
  let buffer = "",
    content = "",
    bytes = 0,
    done = false;
  let data: string[] = [];
  function dispatch() {
    if (!data.length) return;
    const payload = data.join("\n");
    data = [];
    if (payload === "[DONE]") {
      done = true;
      return;
    }
    const event = JSON.parse(payload);
    if (
      event.error ||
      event.code === "music_result_unconfirmed" ||
      event.type === "error"
    )
      throw new Error("音乐生成结果未确认");
    for (const choice of event.choices ?? []) {
      const part = choice.delta?.content ?? choice.message?.content;
      if (typeof part === "string") content += part;
    }
  }
  function line(value: string) {
    if (value.endsWith("\r")) value = value.slice(0, -1);
    if (!value) dispatch();
    else if (value.startsWith("data:"))
      data.push(value.slice(5).replace(/^ /, ""));
  }
  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) {
        buffer += decoder.decode();
        if (buffer) line(buffer);
        dispatch();
        break;
      }
      bytes += chunk.value.byteLength;
      if (bytes > 1024 * 1024) throw new Error("音乐事件流过大");
      buffer += decoder.decode(chunk.value, { stream: true });
      let index;
      while (!done && (index = buffer.indexOf("\n")) !== -1) {
        line(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
    if (!done || !content.trim()) throw new Error("音乐事件流未完整结束");
    return content;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
