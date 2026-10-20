> 来源：https://uselg.top/docs 前端文档模板（ApiDocsView），2026-10-20 提取。`{{MODEL}}` 为 `Lyria-3pro音频音乐`（时长上限约 3 分钟）或 `Lyria-3.5音频音乐`（时长上限约 5 分钟）。

# Lyria 音乐 API 对接说明

。
- 使用绑定本页所选音乐分组的 FluxPort 密钥。同一个音乐分组可调用 Suno 和 Lyria，但每次请求仍需填写所选模型的准确 ID。
- 对接分组需先开通权限；公开报价不自动授予调用权限。可先调用 `GET https://api.uselg.top/v1/models` 确认密钥能看到该模型。
- Key 保存在自己的服务端或环境变量中。

## 计费

本页所选分组售价：**{{PRICE}}**。成功请求按固定单价计费，**不叠加分组倍率**，不按输入 Token、音频秒数或返回曲数另行加价。一次请求返回多段音频仍只计一次；再次 POST 是新请求，可能再次收费。

标准分组与对接分组的单价分别配置，调用密钥所在分组决定实际价格。以本页所选分组和使用记录为准。

## 模型能力

{{DESCRIPTION}}，实际音频时长与格式以生成结果为准；这不是可通过 `duration` 设置的参数，也不保证每次达到该时长。

支持通过文字描述创作音乐。当前已确认的调用格式是文字消息；参考图片、参考音频、上传、续写、歌词分段和独立负面提示词字段尚未提供可用性保证。

## 请求参数

| 字段 | 填写方式 |
| --- | --- |
| model | 必填，`{{MODEL}}` |
| messages | 必填，推荐一条 user 消息 |
| messages[].role | 示例使用 user |
| messages[].content | 必填，非空文字；音乐描述最多 10000 字符 |
| stream | 使用 false，等待完整 JSON |

描述音乐请放在 `messages[].content`，不用顶层 `prompt`。不要额外添加 `duration`、`lyrics`、`negative_prompt`、`n` 等未确认字段。想选择另一款 Lyria，替换完整模型 ID：`Lyria-3pro音频音乐` 或 `Lyria-3.5音频音乐`。

## 直接调用

在服务端设置环境变量 `FLUXPORT_API_KEY`，执行一次：

```bash
curl --request POST 'https://api.uselg.top/v1/chat/completions' \
  --header "Authorization: Bearer $FLUXPORT_API_KEY" \
  --header 'Content-Type: application/json' \
  --max-time 660 \
  --data '{
    "model": "{{MODEL}}",
    "messages": [{"role": "user", "content": "一首雨夜城市的轻快流行歌，女声，温暖钢琴与柔和鼓点。"}],
    "stream": false
  }'
```

660 秒是客户端等待上限，不是完成时间保证。网关和网络也可能更早断开。关闭客户端、SDK 和业务队列对生成请求的自动重试；OpenAI Python SDK 可设 `max_retries=0`。

## Python 示例

仅需 Python 标准库。单次提交、保存完整响应，然后提取音频链接；下载请求不携带 FluxPort Key。

```python
import json
import os
import re
import urllib.error
import urllib.request
from urllib.parse import urlsplit


def audio_links(result):
    if not isinstance(result, dict) or result.get("error") is not None:
        return []
    links = []

    def add(value):
        if not isinstance(value, str):
            return
        value = value.strip()
        try:
            parsed = urlsplit(value)
            if parsed.scheme in ("https", "http") and parsed.hostname and value not in links:
                links.append(value)
        except ValueError:
            pass

    data = result.get("data")
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                for field in ("url", "download_url", "audio_url"):
                    add(item.get(field))
    if links:
        return links
    choices = result.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            message = choice.get("message") if isinstance(choice, dict) else None
            content = message.get("content") if isinstance(message, dict) else None
            if isinstance(content, str):
                for link in re.findall(r"https?://[^\s<>\"')\]]+", content):
                    add(link.rstrip(".,;，。；"))
    return links


def main():
    body = {
        "model": "{{MODEL}}",
        "messages": [{"role": "user", "content": "一首雨夜城市的轻快流行歌，女声，温暖钢琴与柔和鼓点。"}],
        "stream": False,
    }
    request = urllib.request.Request(
        "https://api.uselg.top/v1/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + os.environ["FLUXPORT_API_KEY"],
            "Content-Type": "application/json",
        },
        method="POST",
    )
    # 只提交一次；失败或超时后先核对使用记录，不自动重发。
    try:
        with urllib.request.urlopen(request, timeout=660) as response:
            raw = response.read()
            request_id = response.headers.get("x-request-id", "")
    except urllib.error.HTTPError as error:
        with open("lyria-error.json", "wb") as output:
            output.write(error.read())
        print("HTTP 状态:", error.code, "请求 ID:", error.headers.get("x-request-id", ""))
        raise
    with open("lyria-response.json", "wb") as output:
        output.write(raw)
    result = json.loads(raw)
    links = audio_links(result)
    if not links:
        raise RuntimeError("响应无音频链接；保留响应与使用记录，联系支持，勿自动重发")
    print("请求 ID:", request_id)
    for link in links:
        print("结果链接:", link)
    # 及时下载需要的音频，不把生成 JSON 当作 MP3。
    with urllib.request.urlopen(links[0], timeout=120) as audio:
        content_type = audio.headers.get("Content-Type", "").lower()
        if not content_type.startswith("audio/") and "application/octet-stream" not in content_type:
            raise RuntimeError("下载返回非音频，请检查结果链接；不要重新生成")
        extension = ".mp3" if "mpeg" in content_type else ".wav" if "wav" in content_type else ".audio"
        filename = "lyria-result" + extension
        with open(filename, "wb") as output:
            while chunk := audio.read(1024 * 1024):
                output.write(chunk)
    print("已保存:", filename)


if __name__ == "__main__":
    main()
```

## 读取结果与下载

优先检查 `data[]` 中的 `url`、`download_url`、`audio_url`；没有时检查 `choices[].message.content` 中的 Markdown 或文字链接。响应字段会随实际返回变化，不要硬编码曲数或下载域名。文字中的链接未必全部是音频，请检查下载响应的类型。

生成端点返回 JSON；拿到音频链接后另行下载，及时保存。访问第三方音频地址时**不要发送 FluxPort API Key**。以上说明覆盖响应解析规则，不提供未经实际生成验证的成功响应样本。

## 错误与超时

- 400：检查完整 model、messages、非空 content 和 stream=false。
- 401/403：检查密钥、对应音乐分组权限及账户状态；余额不足以实际错误提示为准。
- 429：按响应提示等待，再决定是否发起新请求。
- 超时、断线、5xx、返回空结果：**不要自动重发**。保存时间、模型 ID、请求 ID、完整响应和错误，核对使用记录，联系支持确认结果。
- 下载失败应重新检查或下载已有链接；不应重新提交生成，也不能仅凭下载失败认定已经退款。

音乐请求同步等待，没有音乐任务查询、回调或已承诺的 `Idempotency-Key` 去重；不轮询 `/v1/videos/{id}`，也不用 `/v1/audio/speech`。
