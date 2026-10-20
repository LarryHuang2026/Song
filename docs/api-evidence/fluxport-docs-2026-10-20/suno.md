> 来源：https://uselg.top/docs 前端文档模板（ApiDocsView），2026-10-20 提取。`${s}` 为所选分组售价占位符。

# Suno 音乐 API 对接说明

输入音乐风格、情绪、主题或歌词要求，返回生成结果与音频下载链接。

## 地址与密钥

- **Base URL：https://api.uselg.top/v1**
- **创建端点：POST /v1/chat/completions**
- **模型 ID：`suno`**
- 请求头：`Authorization: Bearer YOUR_API_KEY`、`Content-Type: application/json`。
- 使用绑定本页所选 Suno 音乐分组的 FluxPort 密钥。专属分组需管理员授权；公开报价不自动授予调用权限。
- 可先调用 `GET https://api.uselg.top/v1/models`，确认当前密钥能看到 `suno`。
- API Key 只保存在自己的服务端或环境变量中，不要嵌入网页、App 或分享给他人。

## 计费

当前所选分组售价：**${s}**。成功请求按固定单价结算，**不叠加分组倍率**，不按输入 Token、音频秒数或返回曲数加价。一次请求即使返回多段音频也只计一次；再次 POST 属于新请求，可能再次收费。

例如单价为 $0.20、分组倍率为 0.2 时，一次成功请求仍为 $0.20。实际扣费和异常结算以使用记录为准。

## 请求参数

| 字段 | 填写方式 |
| --- | --- |
| model | 必填，`suno` |
| messages | 必填，1–32 条消息；推荐一条 user 消息 |
| messages[].role | system、user 或 assistant |
| messages[].content | 推荐字符串，填写风格、情绪、主题及歌词要求；也可使用 text 内容数组 |
| n | 只能为 1；不代表只返回一首音乐 |
| stream | 推荐 false，等待完整 JSON 结果 |

先使用短提示词完成接入。可在文字中描述歌词、人声或器乐偏好，但当前接口没有独立的歌词或纯器乐控制字段，不保证这些要求都能精确执行。

**当前不支持参考音频、音频上传、续写，也没有音乐任务查询或回调接口。** 不要套用 Images API、Videos API 或其他 Suno 平台的参数。

## 直接调用

在服务端设置环境变量 `FLUXPORT_API_KEY` 后执行一次：

```bash
curl --request POST 'https://api.uselg.top/v1/chat/completions' \
  --header "Authorization: Bearer $FLUXPORT_API_KEY" \
  --header 'Content-Type: application/json' \
  --max-time 600 \
  --data '{
    "model": "suno",
    "messages": [{"role": "user", "content": "创作一首温暖的中文流行歌曲，主题是秋天傍晚回家，轻柔吉他和钢琴，旋律舒缓。"}],
    "n": 1,
    "stream": false
  }'
```

600 秒是客户端等待上限，不是生成完成时间保证。代理、网关或客户端也可能更早超时。不要给生成请求配置自动重试。

## Python 示例

仅使用 Python 标准库。发出一次 POST，保存完整响应，并打印结果文字和其中的链接：

```python
import json
import os
import re
import urllib.request

body = {
    "model": "suno",
    "messages": [{"role": "user", "content": "温暖的中文流行歌曲，秋日归家主题，吉他和钢琴，舒缓旋律。"}],
    "n": 1,
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
# 单次提交；异常时保存错误并核对使用记录，不自动重新生成。
with urllib.request.urlopen(request, timeout=600) as response:
    result = json.load(response)
with open("suno-response.json", "w", encoding="utf-8") as output:
    json.dump(result, output, ensure_ascii=False, indent=2)
for choice in result.get("choices", []):
    content = choice.get("message", {}).get("content", "")
    if isinstance(content, str):
        print(content)
        for url in dict.fromkeys(re.findall(r"https?://[^\s<>\"')\]]+", content)):
            print("结果链接:", url.rstrip(".,;，。；"))
```

## 读取与保存音乐

1. 从 `choices[].message.content` 读取完整结果，保存返回的下载链接；不要硬编码链接域名或曲数。
2. 根据实际响应识别音频链接。音频格式、时长和链接有效期以实际结果为准；返回文本中的链接不一定全部都是音频。
3. 及时下载并保存结果。访问第三方结果链接时，**不要携带 FluxPort API Key**。

当前协议在同一次请求中等待结果，不会返回可供 `/v1/videos/{id}` 查询的音乐任务。HTTP 200 后仍应检查结果内容和音频链接能否访问。

## 错误与超时

- 400：核对 model、messages、n 及字段，按错误内容修正。
- 401/403：核对密钥、余额和 Suno 分组权限。
- 429：按响应提示等待后再决定是否发起新请求。
- 超时、连接中断、5xx 或结果为空：**先保存请求时间、返回的请求 ID 和错误信息，核对使用记录，联系支持确认结果；不要自动重发**。
- 当前未承诺音乐请求的 Idempotency-Key 去重，也没有轮询恢复入口。客户端重复 POST 可能产生新的任务与费用。

下载失败与生成失败需要分别核对，不能仅凭下载链接打不开就判定已退款。