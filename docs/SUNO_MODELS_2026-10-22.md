# Suno 版本接入与免费检查 · 2026-10-22

## 实际检查结果

- 使用本机已配置的 FluxPort Key，仅向其原有服务地址发起只读请求，未提交歌曲生成。
- `GET /v1/models`：HTTP 200，当前可见 `suno-v5`、`suno-v5.5`、`suno-v6`、`suno-v6-mini`、`suno-v6-wild` 和两款 Lyria。旧 `suno` 不在这次清单内。
- `GET /v1/usage`：HTTP 200，`isValid: true`，计价单位 `USD`。未保存或披露 Key、余额及原始账户响应。
- 模型清单和鉴权正常不能证明实际生成或下载已恢复；尚未收费实测。

## 新接口适配

根据上游当前公开模型文档，五个版本通过 `/v1/chat/completions` 提交，使用完整模型 ID。`messages` 文本合计上限为 3000 个 UTF-16 单元；`n` 固定为 1，成功请求返回一首；支持独立的布尔参数 `instrumental`。歌词、风格、时长要求仍写在文字提示中，不能强制逐字演唱或精确时长。

推荐 `stream: true`：上游等待期间约每 15 秒发送保活注释，结果由 `choices[].delta.content` 拼接，最后收到 `[DONE]`。客户端已实现分片 UTF-8、CRLF、保活、usage 空事件及结束标记处理；必须有完整结果和音频链接才视为生成已返回。事件错误、未确认结果、断流或只有 DONE 均不会创建成功结果，也不会自动重提。兼容上游返回普通 JSON 的情况。Lyria 不发送未经文档确认的 `n` / `instrumental`，保持非流式。

历史 `suno` 参数快照仍可读取并恢复已有下载；旧入口不再作为新项目默认值。新项目默认 `suno-v6`，已有草稿的模型不会自动改写。

## 版本和费用说明

Suno 官方将 V6 作为标准旗舰选择，Wild 偏探索，Mini 偏快速轻量创作。上游另外列出 V5、V5.5；是否是底层独立旧版本，不能通过模型列表或名称回显确认。

当日公开普通音乐分组 V6/V6 Wild 报价为 USD $0.20/次，V5/V5.5/V6 Mini 为 USD $0.17/次；另有特定对接分组价格。实际 Key 的所属分组、单价和异常扣费以平台记录为准，不能使用旧界面的人民币 ¥0.20 估价。界面已改为提示核对上游当前模型单价。

## 验证

TypeScript、39 项服务端测试、9 条浏览器流程和生产构建通过。新增测试覆盖五个精确模型 ID、请求字段、3000 字符限制、原生纯音乐参数、UTF-8 单字节分片、保活、流内错误、断流、空 DONE、JSON 错误回退、不自动重试、模型选择保存和刷新恢复。浏览器测试使用临时数据库和模拟服务，不消耗真实额度。

本机默认 Node 23 与已安装 SQLite 原生模块不兼容，运行与验证使用已安装的 Node 24。建议另一台电脑按 README 使用 Node 24 LTS。

## 来源

- [FluxPort Suno V6 文档](https://uselg.top/docs?model=suno-v6&group_id=135)
- [FluxPort 公开模型价格数据](https://uselg.top/api/v1/pricing/public)
- [Suno 官方 V6 介绍](https://suno.com/release-notes/introducing-v6)
- [Suno 官方模型选择说明](https://help.suno.com/en/articles/13924993)

公开文档与价格为当日快照结论，后续以平台更新为准。
