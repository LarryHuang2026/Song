# Song · AI Music Studio

本地运行的 AI 音乐创作工作台。以歌曲项目保存灵感、歌词、生成任务和音频版本。

当前支持项目新建/重命名/归档恢复、歌词与参数草稿、FluxPort 文字成歌、并行下载候选、版本试听与选定、原始音频导入/下载，以及无需真实调用的演示模式。支持哼唱录音/上传、标准化与音高分析、本地等长片段替换和 A/B 试听；AI 哼唱成曲与 AI 段落重写入口已开放，标注为实验功能。

## 在另一台电脑使用

先安装 Git、Node.js、Python 3 和 FFmpeg（需同时提供 ffprobe），再克隆代码：

```sh
git clone https://github.com/LarryHuang2026/Song.git
cd Song
```

按下方步骤安装依赖并启动。后续更新可在项目根目录运行 `git pull`，依赖变化时重新安装依赖，然后重启服务。Git 只同步代码；歌曲和项目记录位于 `data/`，需要迁移时先停止服务再单独复制。API Key 请在新电脑重新配置，不要提交到仓库。

## 启动

需要 Node.js 22.12+（建议 Node 24 LTS）、npm、FFmpeg/ffprobe。文字创作可独立运行；哼唱分析和本地片段替换需要 Python 音频服务，已有虚拟环境可直接复用。

```sh
cd web
npm install
cd ..
node scripts/dev.mjs
```

打开 http://127.0.0.1:3100 。启动脚本生成 Prisma Client、应用数据库迁移，再启动 Web、独立 worker，以及已安装的 Python 音频服务（127.0.0.1:8100）。仅监听本机。不要同时运行多个启动脚本或 worker。

默认选择**演示模式**：生成两段 8 秒的合成测试旋律，无歌词演唱、不调用 API。新建项目后即可验证全部本地流程。

首次使用音频分析且没有 Python 虚拟环境时，先在项目根目录安装，然后重新运行启动脚本：

```sh
python3 -m venv audio-service/.venv
audio-service/.venv/bin/python -m pip install -r audio-service/requirements-dev.txt
```

## 哼唱素材与本地编辑

打开歌曲项目后，在顶部选择「哼唱素材」或「本地编辑」。

- 哼唱支持麦克风开始/暂停/恢复/停止、实时波形、预览和原音下载；最长录音 175 秒，上传最长 180 秒 / 50 MB。未保存的录音会阻止切换创作功能或项目，可先保存、下载或丢弃。
- 保存时保留原文件，另存 44.1 kHz 单声道 PCM WAV。可选裁剪首尾静音（50 ms 余量）、约 −20 dBFS RMS 的增益归一化和峰值保护。重处理总是从原文件开始，另存新素材，不覆盖以前的版本。
- 音高曲线使用本地 YIN 差分估计，适合单声部哼唱，范围约 50–1000 Hz；BPM 使用振幅起音自相关，只作参考，可能半速/倍速，弱节奏或静音会返回「未检测到可靠速度」。没有转 MIDI 或自动降噪。
- 本地替换支持波形拖选、10 ms 数值微调、选择项目内歌曲版本或标准化哼唱作为素材、素材起点、0–1000 ms 交叉淡化与可选响度匹配。素材不足会拒绝，不自动循环、拉伸、对齐节拍或变调。支持最长 10 分钟的原曲和素材。
- 替换输出为新版本的 44.1 kHz 立体声浮点 WAV。选区外与**同采样率解码后的原曲**逐样本一致；淡化在选区内部。原文件字节与哈希不改变。原曲已有的过载不在此功能中修复。
- A/B 切换保留播放位置，可试听选区或前后各 2 秒的衔接。调整参数不会修改已保存结果，需要再次执行替换。

以上处理全部在本机完成，不调用音乐模型，也不消耗模型额度。Python 服务停止时，已有素材仍能试听和下载，浏览器录音仍能下载保存。

真实生成使用根目录 `.env.local` 中的 `FLUXPORT_API_KEY` 和 `FLUXPORT_BASE_URL`，格式见 `.env.example`。已有配置不需要复制覆盖。修改配置后重启服务。在界面切换为「FluxPort · 真实生成」，查看费用提示后点击生成。按现有验证记录每次调用约 ¥0.20，通常 Suno 返回两首；最终计费以平台为准。

## AI 实验功能

首页可直接打开「AI 哼唱成曲」与「AI 段落重写」，没有项目时自动创建项目。在「AI 服务配置」中填写 **suno-api.io 独立 Key**，可保存并检测连接；也可使用根目录 `.env.local` 的 `SUNO_API_KEY`。FluxPort Key 不能用于这项服务。界面保存即时生效，环境变量修改后需重启服务。

- 哼唱成曲：上传选定的哼唱素材作为参考，生成歌曲候选；旋律遵循度尚未真实验收。
- 段落重写：以原曲、区间、完整歌词及替换歌词/风格生成，当前不支持额外哼唱条件。仅接受时长符合要求的全曲结果，再在本机重建选区并保留选区外解码采样，保存为关联父版本的新版本。
- 提交 AI 任务会把所选音频发送到该第三方服务。保存 Key、测试连接不会提交生成；界面显示费用提示，实际扣费以平台记录为准。
- 服务设置保存在 `data/provider-settings.json`，权限为 `0600`；该文件含密钥，分享或备份数据时应单独保管。浏览器不会持久保存 Key，公开配置响应也不返回 Key。
- 收费生成不自动重提。已取得歌曲 ID 的任务可在重启后继续查询；查询中断可手动恢复。下载/本地处理失败可恢复保存结果，服务端保留原始候选用于恢复。

两条流程已通过本地模拟服务测试；真实服务尚未配置，实际生成效果和计费仍待验收。接口依据 [suno-api.io 文档](https://www.suno-api.io/en/docs/current-music-generate-from-source/) 接入。

## 工作方式

- 草稿：点击「保存草稿」持久化。切换项目、新建项目、归档和生成前也会保存当前草稿；关闭页面前会提示未保存内容。
- 生成：Web 只负责创建本地队列任务，独立 worker 串行提交；同一任务的多首音频并行下载，显示每首进度。离开页面不影响正在运行的 worker。
- 版本：每首候选独立保存，包含参数快照、来源、实际时长、音频哈希及波形。选定版本不覆盖其他候选。导入 mp3/wav/m4a/flac，最大 50 MB；音频最长 1 小时。
- 失败：生成请求不会自动重试。连接中断或 worker 在提交阶段崩溃，标为「提交结果未知」，须核对平台记录。下载自动最多尝试 3 次，之后可「仅重试下载」，已保存候选不重复下载。链接过期后无法保证恢复。
- 关闭：Ctrl+C 会等待当前生成/下载完成后退出，最长可能数分钟。强制退出会丢失尚未收到的同步接口结果，重启后不会自动重提。
- 保留：音频和 SQLite 位于根目录 `data/`，不会进入 Git。完整备份请先停止服务，再复制整个 `data/`，包括可能存在的数据库 WAL/SHM 文件。`.env.local` 单独保管。

## 独立运行与检查

```sh
cd web
npm run db:generate
npm run db:migrate
npm run dev          # 另一个终端执行 npm run worker
npm run typecheck
npm test
npm run build
npm run test:e2e     # 首次先执行 npx playwright install chromium
cd ..
node scripts/check-client-secrets.mjs
cd audio-service
.venv/bin/python -m pytest -q
```

生产构建后可用 `npm start` 启动 Web，另开终端运行 `npm run worker`。音频功能还需在 `audio-service/` 下执行 `.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8100`。`MUSIC_DATA_ROOT` 可指定独立数据目录（相对路径以项目根目录为准），Web、worker、Python 的 `AUDIO_DATA_ROOT` 和迁移命令必须指向同一目录。默认音频服务地址为 `http://127.0.0.1:8100`，可用 `AUDIO_SERVICE_URL` 修改本机端口。

端到端测试使用临时目录、演示模式、3199/8199 端口和 8198 本地 AI 协议模拟服务及独立 `.next-e2e` 构建目录，不接触真实歌曲或额度。录音测试使用 Chromium 虚拟麦克风，不访问实际麦克风；需要已安装 Python 依赖。若使用系统 Chrome，可执行 `PLAYWRIGHT_CHROME=1 npm run test:e2e`。

## 当前边界

FluxPort 的同步接口没有任务查询、取消或幂等去重；本地仅允许取消仍在排队的任务。提示词中的时长、歌词、无人声要求均不保证精确实现。AI 哼唱成曲、AI 段落重写已通过独立供应商开放实验入口，真实效果待验收；分轨和时间戳歌词尚未开放。演示、API 原生、本地处理与实验功能分别标注。

技术栈：Next.js App Router / React / TypeScript / Prisma / SQLite WAL；独立 Node worker；Python FastAPI 与 FFmpeg。当前界面使用可复用的原生控件和 CSS，后续按交互复杂度引入 WaveSurfer 和更多组件。

更多背景见 [项目概览](docs/PROJECT_OVERVIEW.md)、[能力验证](docs/API_CAPABILITY_PLAN.md)、[架构](docs/ARCHITECTURE.md) 和 [实施路线](docs/IMPLEMENTATION_ROADMAP.md)。
