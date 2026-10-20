# 第三方 Suno API 网关对比（哼唱生成 / 段落替换）

- 调研日期：2026-10-20
- 背景：当前提供方 FluxPort（`api.uselg.top`）只支持通过 `/v1/chat/completions` 做文生音乐（模型 `suno`、`Lyria`），不支持上传音频、cover、extend、段落替换。本文为“第二提供方”选型。
- 方法：只读各家官方文档页面（Mintlify `.md` / OpenAPI / 官方 `llms.txt`），未注册、未调用任何付费接口。
- 标注约定：
  - **【文档】**：官方文档原文明确写到。
  - **【推断】**：根据文档字段/流程推测，未被文档明确确认，需要实测。
  - **【第三方】**：来自非官方来源（博客、对比文章、社区），可信度较低。
  - **文档未提及**：在所读页面中没有找到相关说明。

---

## 1. 汇总表

| 维度 | sunoapi.org（与 api.box 同源） | suno-api.io | MountSea | TTAPI | APIMart | Apiframe |
| --- | --- | --- | --- | --- | --- | --- |
| 上传方式 | 生成接口只收公网 `uploadUrl`；另有自家文件上传 API（multipart 流 / base64 / URL），文件保留 3 天 | `upload-source` 支持 **multipart**、base64、`file_url`；`upload-cover` 支持 base64 / `file_url` | 仅公网 `audioUrl`/`audio_url` | 仅公网 `audio_url` | 仅公网 URL（明确不收二进制） | **不支持上传** |
| 上传时长/大小限制 | 上传音频 ≤ 8 分钟；base64 建议 ≤10MB；URL 上传建议 ≤100MB；分轨用户音频 ≤20MB | 建议 ≤10MB（FAQ）；>8MB 建议走两步；增强上传 ≤80MB | 文档未提及 | 建议 ≤ 8 分钟 | 源音频 < 8 分钟 | — |
| 上传+Cover（哼唱成歌主路径） | ✅ `/api/v1/generate/upload-cover`，`audioWeight`/`styleWeight`/`weirdnessConstraint` 0–1 | ✅ `upload-cover` 或 `upload-source` + `generate-from-source`，`audio_weight` 0–1，可选 `cover_start_s/cover_end_s` | ✅ `task=upload_cover`，`controls.audio_weight`/`style_weight` 0–1 | ✅ `/suno/v1/upload-cover`，`audio_weight`/`style_weight` 0–1 | ✅ `uploadCover`，`audio_weight`/`style_weight` 0–1 | ❌（只能 cover 自家生成的曲目） |
| 上传+Extend | ✅ `upload-extend`（`continueAt`） | ✅ `extend` 可用上传得到的 `clip_id`【文档】 | ✅ `task=upload_extend` | ✅ `upload-extend` | ✅ `uploadExtend` | ❌ |
| 段落替换 | ✅ `replace-section`；**明确支持 `uploadUrl` 模式（上传音频）**；区间 ≥10s 且 ≤ 原曲 50% | ✅ `replace-section`；**明确写上传的 `clip_id` 可用于 replace-section**；区间 ≥2s（实测） | ✅ `replace_section`（自定上下文）/`replace_simple`；区间建议 ≥4s，simple 最大 120s；是否支持上传 clip **文档未明确** | ✅ `replace-section`（`music_id` + 起止秒）；最小区间文档未提及；上传 clip 是否可用文档未明确 | ✅ `replaceMusic`（`task_id`+`audio_index`）；上传任务是否可作为源：文档只写“cover / continuation 等” | ❌ |
| 替换时的音频条件输入（额外参考音频） | ❌ 文档无此类字段（有 `audioWeight`，语义未说明是否作用于替换段） | ❌ 文档未提及 | ❌ 文档未提及 | ❌ 文档未提及 | ❌ 文档未提及 | — |
| 分轨 | ✅ 2 轨 / 12 轨 / 指定乐器；支持用户上传 `audioUrl`（≤20MB） | ✅ `separate`（two / twelve） | ✅ `gen_stem_two` / `gen_stem_all` | ✅ `stems` / `stems-all` | ✅ `stems` / `stems-all` | ✅ 2 轨（仅自家生成） |
| WAV | ✅ `convert-to-wav` | ✅ 免费 | ✅ `/suno/v2/wav`（同步） | ✅（`wav` 已弃用，改 `download` 支持 wav） | ✅ `download`（mp3/m4a/wav） | 文档未提及 |
| 带时间戳歌词 | ✅ `get-timestamped-lyrics` | ✅ `/api/lyrics/timeline`（免费） | ✅ `/suno/v2/timing` | ✅ `alignedLyrics`（免费） | ✅ `aligned-lyrics` | 文档未提及 |
| 异步模型 | taskId + 回调（`callBackUrl` 必填）或轮询详情 | 提交接口“同步受理”（最长约 230s，需 ≥300s 超时）后轮询 `song_id` | taskId + 轮询 `/suno/v2/status` | jobId + 轮询 `fetch` 或 `hookUrl` | task_id + 轮询 `/v1/music/tasks/{id}` | jobId + 轮询 / webhook |
| 结果保留 | 生成文件 14–15 天；上传文件 3 天 | 媒体链接 7 天过期，可免费重新获取链接；作品“长期保留” | 两周 | 文档未提及 | 文档未提及 | 文档未提及 |
| 计费（文档价） | credit 制；官方文档内未找到 cover/replace 单价（见详情） | ¥0.6/次（每次 2 首），上传免费 | 文档未列单价 | upload-cover / replace 6 quota ≈ $0.06；上传 0.5 quota | upload_cover / replace ≈ $0.05/次；上传 ≈ $0.004 | 11 credits/次（credit 单价文档未提及） |
| 注册 / 支付 | 文档未提及具体要求 | 邮箱注册，无需手机号；按次计费、不绑卡 | 在 shanhaiapi.com / offoff.ai 注册（两处文档不一致） | 需激活邮箱（由错误码推断） | 文档未提及；控制台有微信客服 | 文档未提及 |
| 中国可访问性 | 文档未提及 | 下载链接“走国内可用域名”【文档】 | 文档未提及（有中文文档） | 文档未提及 | 文档未提及（本机 curl 访问文档站超时，仅作观察） | 文档未提及 |

---

## 2. 关键结论（先看这里）

1. **没有任何一家文档支持“带额外参考音频的段落替换”**（例如把用户新哼的一段作为替换段的旋律条件）。所有 replace 接口的输入都是：源曲目 + 时间区间 + 歌词/风格。sunoapi.org 的 `replace-section` 带 `audioWeight` 字段，但文档只写“audio consistency 权重”，没有说明它是否、如何作用于替换段，不能当作音频条件输入。
2. **在“上传音频”上做段落替换**，文档明确支持的只有两家：
   - sunoapi.org（及同源 api.box）：`replace-section` 的 Mode 2 直接接受 `uploadUrl` + `model`。
   - suno-api.io：`upload-source` 返回的 `clip_id` “可用于 extend / replace-section / separation”。
   - MountSea / TTAPI / APIMart：上传接口能返回 `clip_id` / `music_id` / 源任务 ID，替换接口也接收这些 ID，但文档没有明说上传得到的 ID 能用于替换【推断可能可行，需实测】。
3. **哼唱成歌**：六家里五家都有 upload + cover 且带 `audio_weight`。但没有任何一家文档专门承诺“哼唱”输入的效果；Suno 的 upload-cover 文档描述是“保留原曲核心旋律、换风格”。哼唱（无伴奏、音准不稳、无歌词）效果必须实测。
4. **本地应用的接入难点是“公网 URL”**：MountSea、TTAPI、APIMart 只收公网 URL，本地应用需要自己找图床/对象存储。suno-api.io 直接收 multipart/base64；sunoapi.org 自带免费的临时文件上传 API（multipart 流），拿到 URL 再调生成接口。
5. **所有候选都是非官方中转**。suno-api.io 的 `llms.txt` 直接写明“通过自有的付费 Suno 账号池提供服务，因为 Suno 不对第三方开放公共 API”；MountSea 文档写“每次上传可能落在不同 Suno 账号”。稳定性和合规性风险对所有候选都存在。
6. **上传内容会被 Suno 做版权指纹检测**【第三方】：有开发者通过 sunoapi.org 上传知名歌曲时收到 `413 Uploaded audio matches existing work of art`；Reddit 上也有误判报告。用户自己的哼唱一般不受影响，但误判仍可能发生。

---

## 3. 各候选详情

### 3.1 sunoapi.org（与 api.box 为同一套文档/后端）

**同源说明【文档】**：docs.sunoapi.org 的 OpenAPI 片段里 `servers` 为 `https://apibox.erweima.ai`、联系邮箱为 `support@api.box`，与 docs.api.box 的页面结构、参数、限制完全一致（api.box 快速开始里的 baseUrl 同为 `https://apibox.erweima.ai/api/v1`）。sunoapi.org 首页文档给出的 API 地址是 `https://api.sunoapi.org`。下文以 sunoapi.org 为准，api.box 视为同一能力集。另有第三方对比文章称 Kie.ai 与 sunoapi.org 共享基础设施【第三方】。

- **上传方式【文档】**
  - 生成类接口（upload-cover / upload-extend / replace-section / add-instrumental）只接收公网 `uploadUrl`。
  - 自家 File Upload API（base `https://sunoapiorg.redpandaai.co`）：`/api/file-stream-upload`（multipart，适合大文件）、`/api/file-base64-upload`（建议 ≤10MB）、`/api/file-url-upload`（建议 ≤100MB，30 秒下载超时）。上传免费，文件 **3 天后自动删除**。
  - 上传音频时长 ≤ 8 分钟（upload-cover / upload-extend）。
  - 来源：https://docs.sunoapi.org/file-upload-api/quickstart 、https://docs.sunoapi.org/suno-api/upload-and-cover-audio
- **Upload + Cover【文档】** `POST /api/v1/generate/upload-cover`
  - 二选一：`uploadUrl`，或已有曲目的 `taskId`+`audioId`。必填 `model`（`V6`/`V6_WILD`/`V6_MINI`）和 `callBackUrl`。
  - 可选：`lyrics`/`prompt`、`style`、`title`、`instrumental`、`vocalGender`、`styleWeight`、`weirdnessConstraint`、`audioWeight`（均 0–1，两位小数）、`variety`（0–4）、`personaId`、`negativeTags`、`duration`（10–360 秒，仅 V5_5/V6 系）。
  - 生成文件 15 天后删除。
  - 来源：https://docs.sunoapi.org/suno-api/upload-and-cover-audio
- **Add Instrumental（哼唱的备选路径）【文档】** `POST /api/v1/generate/add-instrumental`：为上传的“人声或旋律轨”生成伴奏，必填 `uploadUrl`、`title`、`tags`、`negativeTags`、`callBackUrl`，支持 `audioWeight`。注意这条路径会保留原始哼唱人声，适合“哼唱+伴奏 demo”，不等于“重新演唱成完整歌曲”。来源：https://docs.sunoapi.org/suno-api/add-instrumental
- **Upload + Extend【文档】** `POST /api/v1/generate/upload-extend`：必填 `uploadUrl`、`model`、`callBackUrl`；`continueAt` 需 >0 且 < 上传音频时长；文件保留 14 天。来源：https://docs.sunoapi.org/suno-api/upload-and-extend-audio
- **段落替换【文档】** `POST /api/v1/generate/replace-section`
  - Mode 1：`taskId` + `audioId`（已生成曲目），此时不能传 `uploadUrl`/`model`。
  - Mode 2：`uploadUrl` + `model`（**用户上传的音频**），此时不能传 `taskId`/`audioId`。
  - 必填：`prompt`（替换段歌词）、`tags`、`title`、`infillStartS`、`infillEndS`、`fullLyrics`（替换后整首歌词）。
  - 区间：精确到 2 位小数；**至少 10 秒**；**不应超过原曲总时长的 50%**。
  - 上下文：没有“上下文区间”参数；文档写“替换段会自动与前后部分融合”。
  - 可选：`lyrics`、`negativeTags`、`vocalGender`、`styleWeight`、`weirdnessConstraint`、`audioWeight`、`variety`、`personaId`。
  - 音频条件：**没有额外参考音频字段**；`audioWeight` 语义文档未说明。
  - 保留 14 天。
  - 来源：https://docs.sunoapi.org/suno-api/replace-section （api.box 同内容：https://docs.api.box/suno-api/replace-section ）
- **分轨【文档】** `/api/v1/vocal-removal/generate`：`separate_vocal`（2 轨，10 credits）、`split_stem`（最多 12 轨，50 credits）、`split_stem_advanced`（指定乐器，20 credits）；可用已生成曲目或**用户上传的 `audioUrl`（≤20MB）**；结果 14 天；重复调用重复计费。来源：https://docs.sunoapi.org/suno-api/separate-vocals-from-music
- **WAV / 时间戳歌词【文档】**：有 Convert to WAV、Get Timestamped Lyrics 接口（见 https://docs.sunoapi.org/llms.txt ）。单价文档内未看到。
- **异步模型【文档】**：返回 `taskId`；回调分 `text` / `first` / `complete` 三阶段；也可轮询 Get Music Generation Details。错误码含 `430` 频率过高、`455` 系统维护。
- **计费**
  - 官方文档：分轨页给出 credits 数；其余接口指向 https://sunoapi.org/billing （需登录，未能读取）。
  - 【第三方】Apiframe 博客与 musicapi.ai 对比页称 sunoapi.org $5 = 1000 credits（$0.005/credit），并引用 Kie.ai 页面给出 replace section 5 credits、upload-and-extend 12 credits、时间戳歌词 0.5、WAV 0.4。**upload-cover 单价未找到**。
- **注册/支付/中国访问**：文档未提及。
- **版权限制**：官方文档未提及；【第三方】有通过 sunoapi.org 上传知名歌曲被 Suno 返回 `413 Uploaded audio matches existing work of art` 的报告（https://musictechlab.io/blog/music-data/building-a-suno-remix-app-with-nuxt-and-firebase ）。
- **风险**：非官方；同一后端以多个品牌（sunoapi.org / api.box / 可能还有 Kie.ai）出现；`callBackUrl` 在多数生成接口为必填，本地应用需要传一个占位地址并改用轮询【推断】。

### 3.2 suno-api.io

- **定位【文档】**：中文第三方 Suno 服务，有网页工作台和 HTTP API；`llms.txt` 明确写“不隶属于 Suno”“通过自有付费 Suno 账号池提供服务”。来源：https://www.suno-api.io/llms.txt
- **上传方式【文档】**
  - `POST /api/music/upload-source`（**免费**）：支持 JSON（`file_url` / `file_base64`）和 **multipart**（`-F file=@source.mp3`）；返回 `clip_id`，“后续 cover、extend、replace-section、separation 等都可使用”。来源：https://www.suno-api.io/en/docs/current-music-upload-source/
  - `POST /api/music/upload-cover`：`file_url` 或 `file_base64`；音频 >约 8MB 时建议拆成两步。来源：https://www.suno-api.io/en/docs/current-music-upload-cover/
  - FAQ：上传文件建议 ≤10MB。增强上传 `enhanced-upload` 仅 multipart，≤80MB，¥10/次（用于“降低失败率/生成完整可播放歌曲”）。来源：https://www.suno-api.io/ 、https://www.suno-api.io/en/docs/current-music-enhanced-upload/
- **Upload + Cover【文档】**
  - 一步式 `upload-cover`：`prompt`、`style`、`title`、`negativeTags`、`instrumental`、`cover_start_s`/`cover_end_s`（只翻唱源音频中的一段）、`audio_weight`（0.0–1.0，映射 Suno `metadata.control_sliders.audio_weight`，仅有参考音频时可传）。
  - 两步式 `upload-source` → `generate-from-source`（`sourceClipId` + `audio_weight`、`styleWeight`、`weirdnessConstraint`、`vocalGender`、`customMode` 等）。来源：https://www.suno-api.io/en/docs/current-music-generate-from-source/
- **Extend【文档】** `POST /api/music/extend`：`audioId`、`prompt`、`continueAt`（>0，建议后面至少留 10 秒）；上传的 `clip_id` 可用。来源：https://www.suno-api.io/en/docs/current-music-extend/
- **段落替换【文档】** `POST /api/music/replace-section`
  - 字段：`audioId`、`startSeconds`、`endSeconds`、`contextLyrics`（整首歌词，必填）、`contextWindowLyrics`（替换段前后一两句）、`infillLyrics`、`style`、`title`、`negativeTags`，另有 `max_mode` / `variety`。
  - 区间 **至少 2 秒**（团队实测：1.0/1.2/1.5 秒失败，2.0 秒以上成功；过短时报错文案是误导性的“You don't have access to this model”）；必须落在原曲时长内；最大值文档未提及。
  - **上传音频**：upload-source / generate-from-source 两页都明确写上传的 `clip_id` 可用于 replace-section【文档】。
  - 音频条件：文档未提及任何额外参考音频字段。
  - 来源：https://www.suno-api.io/en/docs/current-music-replace-section/
- **分轨 / WAV / 时间戳歌词【文档】**：`separate`（two ¥0.6、twelve ¥3.0）、`vocal-removal` 免费、`wav` 免费、`/api/lyrics/timeline` 免费。来源：https://www.suno-api.io/en/docs/current-overview/
- **异步模型【文档】**：生成类提交接口是“同步受理”——多数 1–3 秒返回，约 10% 超过 30 秒，最长约 230 秒，要求客户端超时 ≥300 秒，超时后不要立刻重试（会重复下单扣费），用 `GET /api/music/songs` 或 `/api/music/query` 确认。`create` 系列支持 `accept_mode: async` 回执模式。
- **保留【文档】**：媒体链接 7 天过期，过期后重新调查询接口可免费拿新链接；作品“长期保留”在账号里。
- **计费【文档】**：¥0.6/次（每次返回 2 首），`max_mode` 翻倍；上传免费；失败自动退款。
- **注册/支付【文档】**：邮箱注册，无需手机号；按次计费，不订阅、不绑卡（具体支付方式文档未提及）。
- **中国访问【文档】**：中文界面；“下载链接走国内可用域名”。
- **版权**：文档列有授权身份相关接口（`/api/music/authorization/*`），上传版权限制具体规则文档未提及（概览只写“上传、cover、替换、WAV 依赖平台账号和源 clip 权限”）。
- **风险**：明确是账号池转售；同步受理 + 长超时容易造成重复扣费；文档提示“若源 clip 无法直接使用，服务端可能根据源音频信息重新上传后再生成”（跨账号问题）。

### 3.3 MountSea（docs.mountsea.ai，原 mountsea.mintlify.app）

- **上传方式【文档】**：`POST /suno/v2/upload` 只收公网 `audioUrl`（MP3/WAV 等），异步，结果里有后续用的 `clip_id`；“每次单独上传可能落在不同 Suno 账号”，同账号需用 Batch Upload Session。大小/时长限制文档未提及。来源：https://docs.mountsea.ai/api-reference/suno/upload
- **Upload + Cover【文档】** `POST /suno/v2/generate`，`task=upload_cover`，必填 `model`（推荐 `chirp-v6`）、`audio_url`；可选 `controls.audio_weight`（原音频影响 0–1）、`controls.style_weight`。来源：https://docs.mountsea.ai/api-reference/suno/generateUploadCover
- **Upload + Extend【文档】**：`task=upload_extend`，`audio_url` + 可选 `continue_at`。来源：https://docs.mountsea.ai/api-reference/suno/generate
- **段落替换【文档】**
  - `task=replace_section`：`clip_id`、`range{start_s,end_s}`、`infill_context_range`（建议覆盖替换段前后各约 30 秒）、`continued_aligned_prompt`（替换后整首歌词）；可选 `prompt`、`infill_lyrics`、`persona`。区间建议 ≥4 秒，过短通常失败并退款。来源：https://docs.mountsea.ai/api-reference/suno/generateReplaceSection
  - `task=replace_simple`：只需 `clip_id` + `range`；服务端对齐到 40ms 网格，不足 4 秒自动扩展，**最大 120 秒**，上下文约 ±15 秒；可只换音乐不换词，或用 `original_infill_lyrics`→`infill_lyrics` 换一句。来源：https://docs.mountsea.ai/api-reference/suno/generateReplaceSimple
  - `/suno/v2/studio/replace`：同语义，强制同账号路由。来源：https://docs.mountsea.ai/api-reference/suno/studioReplace
  - **上传音频是否可替换**：文档未明确。上传返回 `clip_id`，替换接收 `clip_id`【推断可能可行】，但上传可能落在不同账号，而 studio replace 强调同账号路由，存在失败风险。
  - 音频条件：文档未提及。
- **分轨 / WAV / 时间戳歌词【文档】**：`gen_stem_two` / `gen_stem_all`（12 轨）、`/suno/v2/wav`（同步返回 `download_url`）、`/suno/v2/timing`（歌词时间轴）、`/suno/v2/downbeats`。来源：https://docs.mountsea.ai/api-reference/suno/introduction
- **异步模型【文档】**：返回 `taskId`，轮询 `GET /suno/v2/status?taskId=`，建议 3–5 秒间隔；文档未见回调。
- **保留【文档】**：“生成文件保存两周”。来源：https://docs.mountsea.ai/quickstart
- **计费**：Suno 各任务单价文档未列出（只提到 `max_mode` 2 倍计费、custom model 训练 100 credits、Studio 普通剪辑多为免费）。
- **注册【文档】**：Quickstart 写在 shanhaiapi.com 注册，Introduction 写在 offoff.ai 注册——两处不一致。支付方式文档未提及。
- **版权**：`audio_refs` 字段说明写“其他用户的 clip 可能被标记为 remix，商业下载可能被禁用”；上传版权限制文档未提及。
- **风险**：多账号池（文档有 `checkAccountOffline` 接口用于查“执行任务的账号是否掉线”）；Sora2 已标“不可用”，说明上游能力会被下线；文档页存在乱码，维护质量一般。参数表达最完整（上下文区间、40ms 对齐等），说明对 Suno 内部接口贴得很近。

### 3.4 TTAPI（docs.ttapi.io）

- **上传方式【文档】**：`POST /suno/v1/upload` 只收公网 `audio_url`；`is_async=false` 时阻塞返回 `music_id`，`true` 时返回 `jobId`；`upload_mode`：`default`（0.5 quota）/`enhanced`（1 quota，降低失败率，须异步）。来源：https://docs.ttapi.io/api/en/suno/suno_upload
- **Upload + Cover【文档】** `POST /suno/v1/upload-cover`：`audio_url`（建议 ≤8 分钟）、`mv`（`chirp-v6` 等）、`custom`、`instrumental`、`prompt`、`tags`、`style_weight`/`weirdness_constraint`/`audio_weight`（0–1）、`duration`（10–360 秒）、`vocal_gender`、`persona_id`、`hookUrl`。注意：总览页把 `audio_weight` 描述为“平衡音质与生成速度”，与 upload-cover 页“Audio weight 0–1”及其他家语义不一致，属文档质量问题。来源：https://docs.ttapi.io/api/en/suno/suno_upload_cover 、https://docs.ttapi.io/api/en/suno
- **Upload + Extend【文档】**：`/suno/v1/upload-extend`。
- **段落替换【文档】** `POST /suno/v1/replace-section`：必填 `music_id`、`mv`、`infill_start_s`、`infill_end_s`；可选 `prompt`（上下文歌词）、`infill_lyrics`（新歌词）、`tags`、`negative_tags`、`variety`、`max_mode`。最小/最大区间文档未提及；上传得到的 `music_id` 是否可用文档未明确【推断可能可行】；音频条件文档未提及。来源：https://docs.ttapi.io/api/en/suno/suno_replace_section
- **分轨 / WAV / 时间戳歌词【文档】**：`stems`（按 `stem_type` 提取单轨，12 quota）、`stems-all`（30 quota）、`wav`（已弃用，迁移到 `download` 支持 mp3/m4a/wav）、`alignedLyrics`（免费）。
- **异步模型【文档】**：`jobId` + `GET /suno/v2/fetch` 轮询，或 `hookUrl` 回调。
- **保留**：文档未提及（有已弃用的 `isStorage` 参数：true 返回 TTAPI CDN 地址）。
- **计费【文档】**：1 USD = 100 quota；upload-cover / upload-extend / replace-section 均 6 quota（≈$0.06），`max_mode` 翻倍；上传 0.5/1 quota。来源：https://docs.ttapi.io/grids/en/start/pricing/audio
- **注册**：错误码 `401 Wrong TT-API-KEY or email is not activated` 说明需邮箱激活【推断】；支付方式、中国访问文档未提及。
- **风险**：错误码 `403 Account Block`、`499 maximum of suno job queues`、`400 A technical issue with Suno...` 显示上游排队和 Suno 故障会直接透传。

### 3.5 APIMart（docs.apimart.ai）

- **上传方式【文档】**：`POST /v1/music/generations/uploadTask` 只收 JSON，`audioFilePath` 必须是公网 HTTP(S) 链接，“不上传二进制文件”；完成后用该任务的 `task_id` + `audio_index=1` 作为源，“用于 cover / continuation 等”；上传结果不保证有可播放的 `audio_url`。来源：https://docs.apimart.ai/en/api-reference/audios/suno/upload
- **Upload + Cover【文档】** `POST /v1/music/generations/uploadCover`：`audio_url`（源音频 < 8 分钟，不支持本地路径/blob/需登录的链接）、`version`（`v6`/`v6-wild`/`v6-mini`）、`custom`、`instrumental`、`prompt`、`tags`、`style_weight`/`weirdness`/`audio_weight`（0–1）、`vocal_gender`、`duration_s`（10–360）、`audio_format`。来源：https://docs.apimart.ai/en/api-reference/audios/suno/upload-cover
- **Upload + Extend【文档】**：`uploadExtend`。
- **段落替换【文档】** `POST /v1/music/generations/replaceMusic`：`task_id` + `audio_index` 引用源曲；`start_s`/`end_s`（`0 ≤ start_s < end_s`，不超过源时长）；`infill_lyrics`、`prompt`（上下文歌词）、`tags`、`negative_tags`、`variety`、`max_mode`、`audio_format`。最小区间文档未提及；上传任务能否作为替换源文档未明确【推断可能可行，因为概览说所有操作都用 `task_id + audio_index` 引用源】；失败自动退款。来源：https://docs.apimart.ai/en/api-reference/audios/suno/replace-music
- **额外：Flow Music（Lyria）**【文档】：APIMart 还提供 `replaceFlowMusic`（`clip_id` + `start_s`/`end_s` + 自然语言 `instruction`），且 Flow Music 的“Upload Audio”页明确写上传后得到的 `clip_id` 可用于 extend / replace / cover / stem。这是非 Suno 的替代路线。来源：https://docs.apimart.ai/en/api-reference/audios/flow-music/replace
- **分轨 / WAV / 时间戳歌词【文档】**：`stems`、`stems-all`、`download`（mp3/m4a/wav）、`aligned-lyrics`。
- **异步模型【文档】**：`task_id` + 轮询 `GET /v1/music/tasks/{task_id}`（建议先等 3 秒，再每 5–10 秒）；无取消接口。来源：https://docs.apimart.ai/en/api-reference/audios/suno/overview
- **保留**：文档未提及。
- **计费【官网价目】**：upload_cover / upload_extend / replace_section ≈ 0.5 credit（≈$0.05）/次，Max 翻倍；upload ≈ $0.004；stems ≈ $0.1、stems_all ≈ $0.24；aligned_lyrics ≈ $0.0008；download ≈ $0.0016。来源：https://apimart.ai/model/suno
- **注册/支付**：文档未提及；支持渠道含 Discord、Twitter、微信客服、邮件。来源：https://docs.apimart.ai/en/faqs/account-management
- **风险**：综合聚合平台（大量视频/图片/LLM 模型），Suno 只是其中一个上游；本机直接 `curl` 文档站超时（仅为本次调研中的网络观察，不代表服务端不可用）。

### 3.6 Apiframe（apiframe.ai）

- **结论【文档】**：只支持从文本生成后对“自家生成的曲目”做 follow-up：`extend`、`cover`（含 `audio_weight` 0–1）、`add_vocals`、`stems`（2 轨）。**没有上传接口、没有段落替换**。模型列表仍是 V4–V5_5，未见 V6。
- 计费：生成/extend/cover/add_vocals 11 credits，stems 20 credits；credit 单价文档未提及（【第三方】其博客称每次生成约 $0.11）。
- 来源：https://apiframe.ai/docs/music/suno 、https://apiframe.ai/docs/actions 、https://apiframe.ai/docs/actions/suno/cover
- **不满足本项目需求，排除。**

---

## 4. 推荐

### 4.1 哼唱成歌（upload + cover）

1. **首选：suno-api.io**
   - 唯一一家能直接收 **multipart/base64** 的（本地应用不需要先找公网存储），且上传免费、可重试。
   - 有 `audio_weight`、`styleWeight`，以及 `cover_start_s/cover_end_s`，可只用哼唱中有效的一段。
   - 人民币按次计费（¥0.6/次出 2 首），邮箱注册，下载走国内域名，对国内个人使用最友好。
   - 同一个上传 `clip_id` 后续可直接做 replace / extend / 分轨，链路最短。
2. **次选：sunoapi.org（或同源 api.box）**
   - upload-cover 参数最全（`audioWeight` / `styleWeight` / `weirdnessConstraint` / `variety` / `duration`），文档最规范，带三阶段回调。
   - 需要两步：先用其免费的 File Upload API（multipart 流）拿到 3 天有效的 URL，再调 upload-cover。
   - 额外有 `add-instrumental`，可作为“保留哼唱原声 + 配伴奏”的备选模式。
   - 缺点：cover 单价在官方文档里没写清，需要登录后看价目。
3. 备选：TTAPI（$0.06、价目透明）、APIMart（≈$0.05），但都只收公网 URL。

### 4.2 段落替换

1. **首选：suno-api.io**——文档明确“上传的 `clip_id` 可用于 replace-section”，最小区间 2 秒（实测数据），参数同时支持整首歌词、上下文窗口歌词和新歌词。
2. **次选：sunoapi.org**——文档明确支持 `uploadUrl` 模式直接对上传音频做替换；但限制更严：区间 **≥10 秒且 ≤ 原曲 50%**，不能精确修一句短词。
3. MountSea 参数表达力最强（可自定上下文区间，`replace_simple` 最大 120 秒），但“上传音频能否替换”文档未确认，且多账号路由有风险，适合作为“只替换已生成曲目”的后备。
4. **音频条件替换（用新哼唱约束替换段旋律）：所有候选文档均不支持。** 可评估的变通思路【推断，未验证】：
   - 在本地把新哼唱片段拼接进原曲对应位置，上传拼接后的整首，再用 upload-cover（较高 `audio_weight`）重新生成整首——代价是整首都会变化。
   - 或对拼接后的上传音频做 replace-section，让模型以拼接内容为上下文重生成该段——效果完全未知，需实测。

### 4.3 需要的验证步骤（每家小额充值后执行）

1. **哼唱测试集**：准备 3 段自录哼唱（15s / 30s / 60s，不同音准与清晰度），用同一 style、`audio_weight` 取 0.3 / 0.6 / 0.9 各跑一次，人工评估旋律跟随程度。
2. **上传通路**：suno-api.io 用 multipart 直传；sunoapi.org 走 file-stream-upload → upload-cover，确认 3 天 URL 可被生成接口读取。
3. **上传音频替换**：对上传得到的源（suno-api.io `clip_id`、sunoapi.org `uploadUrl`）分别做 replace-section，区间测 2s / 5s / 10s / 30s，确认最小区间、拼接自然度、返回结构。
4. **生成曲目替换**：对各自生成的曲目做同样测试，作为对照。
5. **audioWeight 在 replace 中是否生效**（sunoapi.org）：同一区间 `audioWeight` 取 0 / 1 对比。
6. **MountSea/TTAPI/APIMart 的上传 ID 能否替换**：如作为后备，各跑一次“upload → replace”，确认文档未写明的能力。
7. **稳定性与计费**：连续 20 次提交，统计失败率、平均耗时、是否出现重复扣费（suno-api.io 尤其要验证超时 ≥300s 的处理）。
8. **附加能力**：在上传源上调用分轨、WAV、时间戳歌词，确认是否只对“平台生成曲目”有效。
9. **版权误判**：确认用户原创哼唱不会触发 `matches existing work of art`。
10. **保留期**：记录各家结果链接实际失效时间，应用侧下载后本地保存。

---

## 5. 通用风险提示

- Suno 没有面向第三方的公共 API，所有网关都是非官方中转（suno-api.io 文档直接承认是付费账号池）。Suno 的风控、改版或法律动作都可能导致服务中断或能力下线（例如这些网关都已强制把旧模型映射到 V6）。
- 上游账号池意味着：同一个 clip 在不同账号间可能不可用（MountSea、suno-api.io 文档都提到跨账号处理）。
- Suno 服务条款禁止对其服务进行 scrape、转租等，网关模式本身与 Suno ToS 存在冲突；个人本地使用风险较低，但不应依赖其长期稳定。
- 上传内容会被 Suno 做版权指纹检测，并且存在误判；只上传自己拥有权利的音频。
- 结果链接普遍只保留 3–15 天，应用必须在完成后立即下载到本地。
