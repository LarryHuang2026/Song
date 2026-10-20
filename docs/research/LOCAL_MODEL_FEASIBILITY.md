# 本地开源音乐生成模型可行性调研（M1 Pro 16GB）

- 调研日期：2026-10-20
- 目标机器：Apple M1 Pro，16 GB 统一内存，macOS（darwin 24.6），可用磁盘约 50 GB，无 NVIDIA GPU；现实可用的加速后端是 PyTorch MPS（部分项目另有 Apple MLX 后端）。
- 调研方式：阅读官方 GitHub README / docs、Hugging Face 模型卡与文件列表 API（用于统计权重大小）、GitHub issues（用于 Mac 实测报告）、少量网页搜索。**未下载任何权重，未安装任何包。**
- 标注约定：
  - **【文档】**：官方 README / 文档 / 模型卡明确写出的内容。
  - **【用户报告】**：GitHub issue 或社区页面中的第三方实测，非官方保证。
  - **【推断】**：本文作者根据上述资料做的推理，未经验证。
  - **未找到资料**：本次调研范围内没找到可靠来源。
- 权重大小：取自 `https://huggingface.co/api/models/<repo>?blobs=true` 的仓库文件总大小（2026-10-20 查询）。部分仓库同时存放 `.bin`/`.ckpt` 和 `.safetensors` 两种格式，实际只需下载其中一种，表中会单独注明。
- 活跃度：GitHub star 数和最近 push 时间来自 GitHub API（2026-10-20 查询）。

---

## 1. 结论速览

1. **哼唱成曲（能力 1）**：目前**没有任何官方模型把“跟随用户哼唱旋律”作为已验证功能写进文档**。最接近的路线有两条：
   - **YuE2（2026-09）+ SheetSage2 转谱 +（可选）社区 Hum-to-Song 适配器**：官方文档支持“音频 → 旋律 ABC 谱 → 用新歌词和风格生成带人声的翻唱”（zero-shot cover，`cot="melody"`）。社区适配器 `Mothersuperior/YuE2-hum-to-song` 专门针对 10–30 秒哼唱做了“续写谱子 + 音高/节奏韵律适配器”。官方部署要求是 24GB NVIDIA，但 issue 里已有 **M4 Pro 24GB 跑通 YuE2 的报告（MPS 峰值约 8.5–9.6 GB）**。在 M1 Pro 16GB 上属于“有希望但未验证、比较吃紧”。权重许可为 CC BY-NC 4.0，另附“个人创作者可变现输出”的额外许可。
   - **ACE-Step 1.5 的 Cover 模式（`src_audio` + 新歌词/caption）**：官方说明 `src_audio` 会被量化成包含旋律、节奏、和弦的语义结构，但**官方维护者在 issue 中明确说 Cover 不保证逐音复刻旋律**；另有用户反馈用哼唱转歌“没成功”。好处是 MIT 许可、官方支持 Mac（MPS/MLX），所以适合作为便宜的第一个对照实验。
2. **段落重绘（能力 2）**：**ACE-Step 1.5 的 Repaint 是文档最完整、Mac 支持最好的方案**（`task_type="repaint"`、`repainting_start/end`，区间 3–90 秒，可在区间内换歌词/结构，MIT 许可）。DiffRhythm v1.2 的 `--edit --edit-segments` 可以作为备选。**“用新哼唱驱动某一段重绘”没有任何候选在文档里支持**，只能做实验性拼接（见第 6 节）。
3. 在 M1 Pro 16GB 上明显不现实或不建议的：MiniMax Music 3（仓库 57 GB，8B LLM）、LeVo 2 / SongGeneration-v2-large（官方显存 22–28 GB，官方仓库已下线）、YuE v1（7B stage-1，官方建议 24–80 GB）、MuLaCover（只在 NVIDIA 上验证过，权重和输出都禁止商用）。
4. MusicGen-melody 和 Stable Audio Open **不能生成真实人声**（模型卡原文），只适合“哼唱 → 纯伴奏”这类兜底方案。

---

## 2. 汇总表

> 列含义：人声/歌词/中文；旋律或音频条件；重绘/局部编辑；规模与显存；Apple Silicon 状态；权重下载量；许可；活跃度。详情和来源见第 3 节。

| 模型 | 人声 / 歌词 / 中文 | 旋律或音频条件 | 重绘 / 编辑 / 续写 | 规模 & 显存（文档） | Apple Silicon | 权重下载（HF 仓库总量） | 许可 | 活跃度 |
|---|---|---|---|---|---|---|---|---|
| **ACE-Step 1.5**（2026-02，XL 版 2026-04） | 有人声 / 有歌词 / 50+ 语言【文档】 | `reference_audio`（只管音色/风格）；`src_audio` Cover（旋律+节奏+和弦的语义结构，`audio_cover_strength`）；未写明支持哼唱 | **Repaint**（3–90 秒区间）、Lego、Complete、Extract【文档】 | DiT 2B（约 4.7GB 显存）+ 可选 LM 0.6B/1.7B/4B；“<4GB 显存可运行”【文档】 | **官方支持** MPS + MLX，有 macOS 脚本和便携包【文档】；M1 Pro 有 OOM 报告【用户报告】 | 主仓库（turbo DiT + 1.7B LM + 嵌入模型 + VAE）10.09 GB；0.6B LM 1.37 GB；base/sft 各 4.79 GB；XL-turbo 19.95 GB | MIT（代码+权重） | 13.8k★，2026-10-11 有 push |
| ACE-Step v1（3.5B，2025-05） | 有 / 有 / 19 种语言，中文属于前 10【文档】 | Audio2Audio（参考音频）【文档】 | Repaint、Edit（flow-edit 改歌词）、Extend【文档】 | 最大显存约 8GB（优化后）【文档】 | 有 M2 Max 速度数据；Mac 需加 `--bf16 false`【文档】 | 8.28 GB | Apache-2.0 | 5.0k★，最近 push 2026-02；已被 1.5 取代 |
| **YuE2-3B**（2026-09） | 有 / 有 / 卡片标注 zh、en；示例里有普通话【文档】 | **ABC 符号谱条件**（`abc=` + `cot="melody"/"full"`）；音频先经 SheetSage2 转谱再做 Cover【文档】；社区哼唱适配器【社区】 | 改谱后**整首重新渲染**，官方明确说不会保留编辑区外的波形【文档】 | 3B；官方要求 BF16 NVIDIA 24GB + 24GB 主机内存；4090 峰值约 11 GiB【文档】 | 代码有 MPS 分支；torch 2.10 在 MPS 上有 causal 注意力 bug，需 torch ≥2.13；M4 Pro 24GB 跑通，峰值 8.47–9.55 GB【用户报告】 | YuE2-3B 7.30 GB + VAE 0.53 GB；SheetSage2 0.23 GB + MERT-v2-FullSong 2.53 GB | 代码 Apache-2.0；权重 CC BY-NC 4.0 + 创作者额外许可（个人可变现输出，公司商用需另谈）【文档】 | 12.4k★，2026-10-06 有 push |
| YuE v1（2025-01） | 有 / 有 / 中、粤、英、日、韩【文档】 | 单轨/双轨 ICL（约 30 秒参考歌，管风格）【文档】 | 社区 YuE-extend 续写【文档提及】 | 7B stage-1 + 1B stage-2；24GB 卡最多 2 段，整首建议 80GB【文档】 | 官方无 Mac 说明；社区需改代码【用户报告】 | zh-icl 12.45 GB + s2 3.93 GB | Apache-2.0 | 已转为 YuE-v1 分支 |
| DiffRhythm v1.2（2025-05） | 有 / 有（LRC 带时间戳）/ 中英（README 有中文 G2P）【文档/推断】 | 参考 WAV 或文本只作风格提示（经 MuQ-MuLan）；无旋律条件【文档/代码】 | **`--edit` + `--edit-segments [[s,e],...]`**；v1.2 说明支持编辑和续写【文档/代码】 | base 至少 8GB 显存（需 `--chunked`）【文档】 | 代码自动选择 MPS；README 写“可在 macOS 运行”；M1 Pro 报错，升级到 macOS 15.5 后解决【用户报告】 | DiT 2.22 GB + VAE 0.62 GB（仓库 1.25 GB 含两种格式）+ MuQ-MuLan 2.65 GB | 代码/DiT Apache-2.0；MuQ-MuLan 为 CC BY-NC 4.0 | 2.4k★，最近 push 2025-11 |
| DiffRhythm 2（2025-10） | 有 / 有 / 未找到资料 | 参考 WAV（风格）【文档】 | 续写还在 TODO；编辑未找到资料 | 未找到资料 | README 有 `brew install espeak-ng` 的 Mac 步骤，但说“Linux 可直接用脚本”；MPS 未找到资料 | 5.07 GB | Apache-2.0 | 124★，最近 push 2025-11 |
| SongBloom（2025-06/10） | 有 / 有 / 未核实 | 10 秒 wav 提示（风格）【文档】 | 未找到资料 | 2B；4090 需用 bf16【文档】 | 未找到资料 | 单个 ckpt 约 7.3–7.8 GB + VAE 0.68 GB【二手】 | 说法冲突（镜像写 Apache-2.0，另一镜像写 CC BY-NC-SA 4.0） | **官方 GitHub/HF 已删除**，只剩 ModelScope 和社区镜像【二手】 |
| LeVo 2 / SongGeneration-v2-large（2026-03） | 有 / 有 / zh、en、es、ja 等【文档】 | 10 秒 prompt 音频（风格）【文档】 | 未找到资料 | 4B；22GB / 28GB（带 prompt 音频）；base 版 10GB / 16GB【文档】 | 社区有 MLX 移植（8bit 5.0G、4bit 2.7G）【社区】 | v2-large 12.90 GB | 自定义 LICENSE（未核实全文） | **官方仓库 2026 年下线**（GitHub 404 / HF 401）【二手】 |
| HeartMuLa-oss-3B（2026-01/02） | 有 / 有 / 多语言【文档】 | 参考音频条件还在 TODO【文档】 | 未找到资料 | 3B；RTF≈1.0（未写 GPU）【文档】 | MPS 有报错，用户打补丁后能跑；缺 triton【用户报告】 | 3B 15.75 GB + Codec 6.64 GB | Apache-2.0 | 3.8k★，2026-10-08 有 push |
| **MuLaCover**（2026-09，基于 HeartMuLa） | 有 / 有（含中文示例）/ 中文【文档】 | **旋律 + 和弦 MIDI**，或参考音频（经 YourMT3 + ChordNet 转符号）【文档】 | 未找到资料 | 未写显存；默认懒加载【文档】 | 只在 Linux + NVIDIA（B300）上验证过【文档】 | 8.76 GB + Codec 6.64 GB + Qwen3-Embedding-0.6B | 代码 Apache-2.0；**权重和输出均禁止商用**【文档】 | 112★，2026-09-26 有 push |
| MiniMax Music 3（2026） | 有 / 有 / 未核实 | 未找到资料 | 未找到资料 | 8B 全局 LLM + 0.6B；24GB 或 8GB（CUDA 逐层流式）【文档】 | 未找到资料 | 仓库 57.35 GB | MiniMax-Music3 社区许可（年营收 >2000 万美元需授权） | 新 |
| MusicGen-melody（audiocraft） | **不能生成真实人声**【模型卡】 | **色度图（chroma）旋律条件** `generate_with_chroma`【文档】 | 支持音频续写（prompt）【文档】 | 1.5B（另有 3.3B）；中等模型建议 16GB 显存【文档】 | 官方写“必须有 GPU”，MPS 未找到官方资料 | melody 9.24 GB（含 `.bin` 和 safetensors 双份；单份约 6.2 GB） | 代码 MIT；权重 CC BY-NC 4.0 | 23.8k★，最近 push 2026-03 |
| Stable Audio Open 1.0 / Small | **不能生成真实人声**；只训练了英文描述【模型卡】 | 文本 + 时长；stable-audio-tools 有 inpaint 模型类型（SAO 1.0 是否支持未核实） | 未找到资料 | 1.0 约 1B，最长 47 秒【模型卡】 | 未找到资料 | 1.0 仓库 15.68 GB（含多份格式，单份约 5.5 GB）；Small 5.03 GB（同样含多份） | Stability AI Community License（gated） | stable-audio-tools 3.9k★，活跃 |

---

## 3. 逐模型详情

### 3.1 ACE-Step 1.5（重点候选）

来源：
- README：https://github.com/ace-step/ACE-Step-1.5
- 教程：https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/Tutorial.md
- 推理 API：https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/INFERENCE.md
- GPU 兼容性：https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/GPU_COMPATIBILITY.md
- 安装：https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/INSTALL.md
- Gradio 指南：https://github.com/ace-step/ACE-Step-1.5/blob/main/docs/en/GRADIO_GUIDE.md
- 技术报告：https://arxiv.org/abs/2602.00744
- 模型：https://huggingface.co/ACE-Step/Ace-Step1.5

**文档事实**
- 许可：MIT（LICENSE 文件为 “Copyright (c) 2026 ACEStep”）。
- 人声和歌词：生成带人声的完整歌曲，10 秒到 10 分钟，“50+ 语言”歌词。
- 架构：一个 5Hz LM（基于 Qwen3 的 0.6B/1.7B/4B）负责“规划”，再由 DiT（2B 或 XL 4B）生成音频。LM 表里有一列 “Copy Melody”：0.6B 为 Weak，1.7B 为 Medium，4B 为 Strong。
- 音频控制，分三类：
  1. `reference_audio`：控制全局音色、混音、演唱风格。教程原文说它的编码“去除了具体旋律、节奏等结构信息”，所以**不能用来跟随哼唱**。
  2. `src_audio` + `task_type="cover"`：把源音频量化成语义结构，包括“Melody: note direction and pitch、Rhythm、Chords、Orchestration”；可以同时更换 caption 和 lyrics，用 `audio_cover_strength`（0–1）控制源音频的影响强度。
  3. `task_type="repaint"`：基于上下文补全，可以重绘开头、中间、结尾或任意区域，区间 **3–90 秒**；可以“只改歌词、保留旋律和编曲”、改结构、续写。参数为 `repainting_start` / `repainting_end`（秒，`-1` 表示到结尾），`chunk_mask_mode="explicit"`。
  - 另外 Base 模型独有 `lego`（给已有音轨加新轨）、`complete`（给单轨，例如清唱人声，配完整伴奏）、`extract`（分离音轨）。
- 对 cover / repaint / extract 任务，`thinking`（LM）会被自动忽略。**【推断】因此这几个任务理论上可以不加载 LM，以节省内存。**
- Mac 支持：要求 Python 3.11–3.12；“also supports MPS”；macOS 脚本 `start_gradio_ui_macos.sh` 使用 **MLX 后端**（M1/M2/M3/M4）；另有 macOS 便携包。`profile_inference.py --device mps --lm-backend mlx` 可做基准测试。
- 显存分级：12–16GB 推荐 2B turbo/sft + 0.6B/1.7B LM；≤6GB 可只用 DiT 并开启 INT8 和 CPU offload。XL（4B）在 12–16GB 属于“边缘可用”，需要 offload 和量化。
- 速度：A100 上整首不到 2 秒，RTX 3090 不到 10 秒。**没有 Mac 的官方速度数据。**

**用户报告（GitHub issues）**
- 哼唱转歌：#1100（2026-04）用户尝试把哼唱转成歌曲，“几次尝试都没成功，只是稍微改了改我的哼唱”；另一位用户说在线版也没得到正确结果。https://github.com/ace-step/ACE-Step-1.5/issues/1100
- Cover 不保证旋律：#972 维护者 ChuxiJ 回复，Cover 更像“按这个风格生成”，**“does not preserve the exact melody note-for-note”**，并说这是预期行为。https://github.com/ace-step/ACE-Step-1.5/issues/972
- Mac 上 Cover 的 bug：#1346（2026-10-02，未关闭）**原生 MLX DiT 会忽略 `cover_noise_strength`（Melody Retention）**；关闭 MLX DiT、改用 PyTorch/MPS 后，输出能紧密跟随源音频。https://github.com/ace-step/ACE-Step-1.5/issues/1346
- **M1 Pro 的 OOM**：#1336（2026-09-23）MacBook M1 Pro，配置 turbo + 0.6B LM + mlx，报错 `MPS backend out of memory (MPS allocated: 10.33 GiB, other allocations: 7.80 GiB, max allowed: 18.13 GiB)`。【推断】18.13 GiB 的上限与 16GB 机器的默认 MPS 水位线一致，所以这很可能就是 16GB 机型。https://github.com/ace-step/ACE-Step-1.5/issues/1336
- 非蒸馏模型在 Apple Silicon 上音频变糊：#1259，xl-base / xl-sft 的输出糊掉，根因是 DCW 默认开启；Gradio 已在 #1207 修改默认值，CLI/API 需要显式设置 `dcw_enabled=False, shift=1.0`。turbo 模型正常。https://github.com/ace-step/ACE-Step-1.5/issues/1259

**权重下载**
- `ACE-Step/Ace-Step1.5` 主仓库 10.09 GB（turbo DiT 4.79 + 1.7B LM 3.71 + Qwen3-Embedding-0.6B 1.19 + VAE 0.34）。
- `acestep-5Hz-lm-0.6B` 1.37 GB；`acestep-v15-base` / `-sft` 各 4.79 GB；XL-turbo 19.95 GB（不建议在 16GB 机器上用）。

**推断**
- 在 16GB 机器上，用 2B turbo、**不加载 LM**（cover/repaint 本来就不用 LM）的配置做 repaint，可行性最高。
- 哼唱成曲方面，Cover 模式可以拿来实验，但文档和用户报告都不支持“能可靠跟随哼唱”。另一个思路是让用户**带词清唱**（不是哼唱），再用 Base 模型的 `complete` 任务配伴奏，这样最终人声就是用户自己的声音，旋律自然 100% 保留。但这改变了产品形态，而且 Base 模型非蒸馏，在 Mac 上要注意上面 DCW 的坑。

### 3.2 ACE-Step v1（3.5B）

来源：https://github.com/ace-step/ACE-Step ，https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B

- 【文档】Apache-2.0。19 种语言，中文属于表现较好的前 10。
- 【文档】支持 Repainting（指定起止时间重绘）、Lyric Editing（flow-edit，“只能一次改小段歌词”）、Extend、Audio2Audio（2025-05-09 加入）；有 RapMachine 中文说唱 LoRA。
- 【文档】速度表：**MacBook M2 Max** 在 27 步时 RTF 2.27×（1 分钟音频需 26.43 秒），60 步时 RTF 1.03×（58.25 秒）。macOS 需要 `--bf16 false`。2025-05-10 起最大显存降到 8GB。
- 权重 8.28 GB。最近 push 在 2026-02，**已被 1.5 取代**。【推断】除非 1.5 在 M1 上跑不通，否则没有理由优先选 v1。v1 是唯一有官方 Apple Silicon 速度数据的版本，可以作为对 1.5 速度的粗略参考（M1 Pro 的 GPU 弱于 M2 Max，【推断】速度会更慢）。

### 3.3 YuE2-3B + SheetSage2（哼唱成曲的重点候选）

来源：
- README：https://github.com/multimodal-art-projection/YuE
- 翻唱指南：https://github.com/multimodal-art-projection/YuE/blob/main/docs/covers.md
- 生成指南：https://github.com/multimodal-art-projection/YuE/blob/main/docs/generation.md
- 编辑指南：https://github.com/multimodal-art-projection/YuE/blob/main/docs/editing.md
- 模型卡：https://huggingface.co/m-a-p/YuE2-3B
- SheetSage2：https://huggingface.co/m-a-p/SheetSage2
- 论文：https://arxiv.org/abs/2609.33757

**文档事实**
- 许可：代码 Apache-2.0；**权重 CC BY-NC 4.0，另附创作者额外许可**。个人用户、内容创作者、音乐人可以免费使用并**变现生成的作品**；学术用途仅限非商业；**公司商用权重需要联系作者**。SheetSage2 和 MERT-v2 权重也是 CC BY-NC 4.0。
- 人声、歌词、语言：完整歌曲（人声+伴奏），48 kHz 立体声；模型卡语言标注为 `zh`、`en`；示例有普通话歌曲。
- 架构：AR–NAR 混合 Transformer。先自回归生成 **ABC 符号谱**（旋律+和弦规划），再生成语义 token，然后 flow matching 生成声学 latent，最后 VAE 解码。
- **旋律条件**：`abc=` 可以传入自己的谱子。`cot="melody"` 表示使用给定旋律、伴奏自由发挥（推荐用于翻唱）；`cot="full"` 表示旋律和和弦都固定。
- 翻唱流程：用 SheetSage2 把源录音转成 melody-only ABC（`--melody-only`），检查谱子，再配新歌词和风格，以 `cot="melody"` 生成。文档提醒“转谱错误会传递到翻唱中”，并说换歌词时要对齐乐句和音节数。
- 评测：zero-shot 翻唱在 948 首作品上 CLEWS mAP 0.647（不给谱时为 0.006）。**这是对“原曲录音”的评测，不是对哼唱的评测。**
- 编辑：改 ABC 谱后重新渲染，原文 “**Editing renders a new complete recording … does not preserve the original waveform outside an edit**”。所以 **YuE2 不支持保留原波形的局部重绘。**
- 硬件：官方起点是 “Linux · Python 3.12 · BF16 NVIDIA 24GB”；模型卡写需要 24GB 可用主机内存，最大上下文测试峰值 14.08 GiB；4090 上生成 215 秒音频约 69–71 秒，峰值约 11 GiB。
- SheetSage2：Python 3.10/3.11 + FFmpeg 6.1 共享库；示例 `.to("cuda" if available else "cpu")`，【推断】可以在 CPU 上跑。用 `trust_remote_code=True`。

**用户报告**
- #176（2026-09-14，未关闭）https://github.com/multimodal-art-projection/YuE/issues/176 ：`yue2-infer` 0.1.6 的代码**明确有 MPS 分支**（`device="auto"` 会选 MPS），但锁定的 torch 2.10.0 在 MPS 上的 BF16 `is_causal=True` 注意力有静默 bug（会泄漏未来 token），PyTorch 2.13.0 修复。
  - 第二位用户在 **Mac mini M4 Pro 24GB** 上用 torch 2.14.0 跑通三次完整生成：70 秒音频耗时 3 分 02 秒（2.6× 实时），峰值 MPS 8.47 GB；150 秒音频耗时 7 分 25 秒（3.0×），峰值 9.48 GB；215 秒日语歌耗时 12 分 23 秒（3.5×），峰值 9.55 GB。首次加载约 16 秒。原话：“24 GB of unified memory was enough”。

**社区哼唱适配器（非官方）**：https://huggingface.co/Mothersuperior/YuE2-hum-to-song
- 【社区文档】输入 10–30 秒哼唱 + 风格 + 歌词。第一阶段（无需训练）：用 SheetSage2 把哼唱转成 ABC，作为“开放的谱子前缀”交给 YuE2 续写；提供 “continue from hum / **hum only**（歌曲旋律就是你的哼唱）/ ignore hum” 三种模式。第二阶段（训练过的适配器）：用 pYIN 提取 f0，合成正弦载波，经 VAE 编码后注入 NAR 解码器（4 个投影 + rank-64 LoRA），提供“hum influence” CFG。
- 【社区文档】作者自己的说法：适配器效果“很细微、是刻意设计的”，旋律主要由第一阶段的谱子决定；转谱器“需要像人声的输入，纯正弦音转不出来”。评测只有一张 loss 表（0.960 → 0.906），**没有旋律准确率指标**。
- 权重 0.28–0.42 GB；CC BY-NC 4.0；带 ComfyUI 节点。硬件和 MPS 支持：**未找到资料**。

**推断（M1 Pro 16GB）**
- 内存：M4 Pro 上峰值约 8.5–9.6 GB，16GB 机器的 MPS 默认推荐工作集大约 10–11 GB，**能放下但余量很小**，需要关掉其他应用，并且只生成短片段（30–60 秒）。
- 速度：M1 Pro 的 GPU 弱于 M4 Pro，【推断】可能比 2.6–3.5× 实时再慢 1.5–2 倍，30 秒片段大约需要 2.5–5 分钟。**需要实测。**
- 必须把 torch 升到 ≥2.13 才能避开 MPS 的 causal 注意力 bug，这会偏离官方锁定版本，有兼容风险。
- 从路径上看，YuE2 是唯一一个**以显式旋律（谱子）为条件、而且有官方翻唱评测**的带人声模型，所以它在“跟随哼唱”这件事上的上限最高；不确定性主要在 SheetSage2 对哼唱的转谱质量。

### 3.4 YuE v1

来源：https://github.com/multimodal-art-projection/YuE/tree/YuE-v1
- 【文档】Apache-2.0（2025-01-30 起）；支持中、粤、英、日、韩；ICL 模式需要约 30 秒参考歌（只管风格）；不支持旋律条件。
- 【文档】24GB 卡最多 2 个 session，整首歌建议 80GB；H800 上 30 秒音频要 150 秒，4090 上约 360 秒。
- 【用户报告】#13、#51：没有官方 Mac 支持，需要改代码；社区有 YuEGP 等低显存版本。
- 【推断】已被 YuE2 取代，在 M1 16GB 上不现实。

### 3.5 DiffRhythm v1.2 / DiffRhythm 2

来源：https://github.com/ASLP-lab/DiffRhythm ，https://github.com/xiaomi-research/diffrhythm2 ，代码 `infer/infer.py`
- 【文档】代码和 DiT 权重为 Apache-2.0；v1.2（2025-05-09）“enables song editing and continuation”；2025-03-11 说明 “can now run on MacOS”；base 至少需要 8GB 显存（加 `--chunked`）。歌词使用带时间戳的 LRC；风格来自参考 WAV 或文本提示（经 MuQ-MuLan，**CC BY-NC 4.0**）。
- 【代码】`--edit`、`--ref-song`、`--edit-segments "[[start1,end1],...]"`（单位秒）；设备按 cuda → mps → cpu 自动选择。
- 【用户报告】#114：M1 Pro 报 `Output channels > 65536 not supported at the MPS device`，升级到 macOS 15.5 后解决（本机为 macOS 15.x / darwin 24.6，【推断】应该没有这个问题）。#68：Mac 整合包报“没有 cuda”，维护者说是整合包的问题。
- 旋律条件：**无**。只有风格参考，没有哼唱或旋律输入。
- DiffRhythm 2（2025-10）：Apache-2.0，权重 5.07 GB；续写和 Gradio 都还在 TODO；Mac/MPS 未找到资料。
- 【推断】DiffRhythm 是能力 2 的备选（代码层面支持分段编辑，也能跑 MPS），但它需要 LRC 时间戳，编辑质量没有公开评测，仓库最近 push 是 2025-11，活跃度在下降。

### 3.6 SongBloom

来源（二手）：搜索结果中的旧 README 快照、镜像 https://huggingface.co/rtikw/SongBloom
- 【文档快照】2B；150 秒和 240 秒两个版本；用 10 秒 wav 作提示；4090 需要 bf16。
- 【二手】**官方 GitHub（tencent-ailab/SongBloom）和 HF（CypressYang）已被作者删除**（本次核实：GitHub 返回 404，HF 返回 401），只剩 ModelScope 和社区镜像。许可说法冲突（Apache-2.0 vs CC BY-NC-SA 4.0）。
- 旋律条件、重绘、Mac：**未找到资料**。YuE2 的 WildSongBench 中 SongBloom 得分最低（4.2350）。
- 【推断】不建议投入。

### 3.7 LeVo / SongGeneration 2

来源：README 快照 https://github.com/tencent-ailab/SongGeneration （当前 404）、https://huggingface.co/lglg666/SongGeneration-v2-large 、https://huggingface.co/mlx-community/SongGeneration-v2-large 、https://postcutoff.com/m/songgeneration-2/
- 【文档快照】v2-large 4B，支持 zh、en、es、ja 等，最长 4 分 30 秒；显存 22GB（无 prompt 音频）/ 28GB（有 prompt 音频）；base 版 10GB / 16GB，但只支持中文或中英；prompt 音频只取前 10 秒，用作风格参考；可以输出纯人声或人声/伴奏分轨。
- 【二手】官方 GitHub 和 HF 在 2026 年下线；社区有 fork 和 MLX 移植（token 生成用 MLX，解码仍用 PyTorch）。
- 旋律条件、重绘：**未找到资料**。
- 【推断】可用性和许可都不确定，不建议用于本项目。

### 3.8 HeartMuLa / MuLaCover

来源：https://github.com/HeartMuLa/heartlib ，https://github.com/HeartMuLa/MuLaCover ，https://github.com/HeartMuLa/MuLaCover/blob/main/examples/cover_song_generation.md
- HeartMuLa-oss-3B：【文档】Apache-2.0；多语言；RTF≈1.0；参考音频条件还在 TODO。权重 15.75 GB + Codec 6.64 GB。【用户报告】#56：MPS 上 `.type(timesteps.type())` 报错，用户把它改成 `.to(device, dtype)` 后能在 M4 Max 上出结果；#85：Mac 缺 triton。
- **MuLaCover（2026-09-16）**：【文档】“reference audio … or **melody/chord MIDI**” + 新歌词 + 风格标签 → 翻唱或混音（带人声；示例是中文歌词）。命令行参数：`--melody_midi`、`--chord_midi`、可选 `--drum_midi`，或 `--ref_audio`（经 YourMT3 + ChordNet 转成符号）。MIDI 时序按拍读取。
  - 【文档】**只在 Ubuntu 24.04 + NVIDIA B300 上验证过**；安装说明要求 Linux + NVIDIA。**权重和生成输出都是 CC BY-NC 4.0 + MODEL_LICENSE，未经书面授权禁止商用。**
  - 权重 8.76 GB + Codec 6.64 GB + Qwen3-Embedding-0.6B。
- 【推断】从输入形态看，MuLaCover 是最贴近“哼唱 → MIDI → 带人声歌曲”的方案（可以用 basic-pitch 把哼唱转成 melody MIDI；chord MIDI 看起来是必填，需要另外推和弦）。但它对 Mac 没有任何支持记录，权重合计约 16 GB 以上，在 16GB 统一内存上风险很高，所以只列为观察对象。

### 3.9 MiniMax Music 3

来源：https://huggingface.co/MiniMaxAI/MiniMax-Music3 ，https://docs.comfy.org/tutorials/audio/minimax/minimax-music-3
- 【文档】8B 全局 LLM + 0.6B 局部 LLM + Flow-VAE；24GB 显存可以跑全精度，CUDA 上逐层流式可降到 8GB；许可是社区许可（商用产品需在界面标注，年营收超过 2000 万美元需要授权）。
- 仓库 57.35 GB。旋律条件、重绘、Mac 支持：**未找到资料**。
- 【推断】磁盘和内存都超出本机条件，排除。

### 3.10 MusicGen-melody（audiocraft）

来源：https://github.com/facebookresearch/audiocraft/blob/main/docs/MUSICGEN.md ，模型卡 https://github.com/facebookresearch/audiocraft/blob/main/model_cards/MUSICGEN_MODEL_CARD.md
- 【文档】`generate_with_chroma(descriptions, melody, sr)`，用色度图做旋律条件；模型卡评测了 “Adherence to the melody”，musicgen-melody 的 Chroma Cosine Similarity 为 0.44。支持音频续写。
- 【文档】**“The model is not able to generate realistic vocals.”**；没有歌词输入。代码 MIT，权重 CC BY-NC 4.0。1.5B（melody）/ 3.3B（melody-large）；中等模型建议 16GB 显存，“you must have a GPU”。audiocraft 要求 PyTorch 2.1.0。
- MPS：官方文档**未找到资料**。【推断】Hugging Face transformers 也有 MusicGen Melody 实现，也许能在 MPS 上跑，本次未核实。
- 【推断】适合“哼唱 → 跟随旋律的纯伴奏”这种兜底方案（再叠加用户自己的人声）。不满足“生成人声”。

### 3.11 Stable Audio Open 1.0 / Small

来源：https://huggingface.co/stabilityai/stable-audio-open-1.0 ，https://github.com/Stability-AI/stable-audio-tools
- 【文档】最长 47 秒，44.1 kHz 立体声，只有文本条件；“not able to generate realistic vocals”；只用英文描述训练；Stability AI Community License（gated，商用需看 stability.ai/license）。stable-audio-tools 的模型类型里有 `diffusion_cond_inpaint`，但 SAO 1.0 本身是否支持 inpaint **未核实**。
- 相关研究：MIDI-SAG（https://github.com/fundwotsai2001/MIDI-SAG）在 SAO 1.0 上用 MuseControlLite 适配器，按人声旋律 MIDI 生成伴奏。【推断】是研究型流水线，依赖较多。
- 【推断】与本项目两个目标都不匹配。

### 3.12 旋律预处理工具（只作前处理，不生成歌曲）

| 工具 | 用途 | 许可 | Mac 支持 | 来源 |
|---|---|---|---|---|
| basic-pitch（Spotify） | 音频 → MIDI（含弯音），轻量 | Apache-2.0 | 【文档】macOS 默认用 CoreML 推理；**M1 只支持 Python 3.10** | https://github.com/spotify/basic-pitch |
| torchcrepe | 单音 f0 估计（PyTorch） | MIT | 未找到官方 MPS 说明（【推断】CPU 即可） | https://github.com/maxrmorrison/torchcrepe |
| librosa `pyin` | 单音 f0 估计（概率 YIN），纯 CPU | ISC | 纯 Python/NumPy，【推断】无平台问题 | https://github.com/librosa/librosa |
| SheetSage2 | 音频 → 旋律/和弦 ABC 与 MIDI（YuE2 体系） | CC BY-NC 4.0 | 示例支持回退到 CPU；需要 FFmpeg 6.1 | https://huggingface.co/m-a-p/SheetSage2 |

用途：
- 生成 ACE-Step 的 BPM / key 元数据；
- 给 MuLaCover 提供 melody MIDI；
- **作为测试中衡量“旋律跟随度”的客观指标**（见第 7 节）。

---

## 4. M1 Pro 16GB 可行性评估

| 方案 | 内存可行性 | 速度预期 | 主要风险 | 总体判断 |
|---|---|---|---|---|
| ACE-Step 1.5，2B turbo，不加载 LM，做 Repaint/Cover | 【文档】DiT 权重约 4.7GB，“<4GB 显存可运行”（需量化和 offload）；【用户报告】M1 Pro 开启 0.6B LM 时出现过 OOM | 无官方 Mac 数据；【推断】30–60 秒片段在分钟级以内 | MLX DiT 在 Cover 中忽略 Melody Retention（#1346）；MPS OOM（#1336） | **最可行**，优先测试 |
| YuE2-3B（MPS，torch ≥2.13） | 【用户报告】M4 Pro 峰值 8.5–9.6 GB；【推断】16GB 机器上很紧 | 【用户报告】M4 Pro 为 2.6–3.5× 实时；【推断】M1 Pro 可能 4–7× 实时 | 偏离官方 torch 锁定版本；BF16/MPS 数值问题；SheetSage2 对哼唱的转谱质量没有评测 | **有条件可行**，是能力 1 的主攻对象 |
| DiffRhythm v1.2（MPS） | 【文档】8GB 显存（chunked） | 未找到 Mac 数据 | 需要 LRC 时间戳；编辑质量未知；MuQ-MuLan 非商用 | 能力 2 的备选 |
| MusicGen-melody（只出伴奏） | 1.5B，【推断】可以放下 | 未找到 Mac 数据 | 没有人声；非商用 | 兜底方案 |
| MuLaCover / HeartMuLa | 权重 16GB 以上；没有 Mac 验证 | — | 只验证过 NVIDIA；禁止商用 | 暂不考虑 |
| LeVo 2、MiniMax Music 3、YuE v1、SongBloom | 超出内存/磁盘，或官方已下线 | — | — | 排除 |

通用注意事项（【推断】）：
- 16GB 统一内存由 CPU 和 GPU 共享，MPS 实际可用量大约 10–11 GB（默认水位线）。设置 `PYTORCH_MPS_HIGH_WATERMARK_RATIO=0.0` 可以解除上限，但官方报错信息本身就警告“may cause system failure”，**不建议**这么做，宁可缩短片段、减小 batch。
- 一次只加载一个模型；测试时关掉浏览器等占内存的应用。
- 需要设置 `PYTORCH_ENABLE_MPS_FALLBACK=1`，让不支持的算子回退到 CPU（社区项目 ace-music-studio 就这么做）。

---

## 5. 推荐

### 能力 1：哼唱 → 歌曲（带人声）
- **首选（需验证）：YuE2-3B + SheetSage2（melody-only ABC）+ `cot="melody"`，先用社区适配器的 “hum only” 思路（只做第一阶段，不训练）。** 理由：它是唯一一个以**显式旋律谱**为条件、有官方翻唱评测、而且有 Apple Silicon 跑通报告的带人声模型；音高和节奏通过谱子硬约束传入，可解释、可人工修正（ABC 谱可编辑）。许可方面，个人使用和个人变现输出被明确允许，但做成公司产品需要授权。
- **对照（便宜）：ACE-Step 1.5 Cover**（`src_audio` = 哼唱，`audio_cover_strength` 设高，Mac 上**关闭 MLX DiT**）。文档和用户报告都不看好它能跟随哼唱，但它安装成本低，又是能力 2 必装的，顺手测一次。
- **兜底：** ① 用户带词清唱，用 ACE-Step 1.5 Base 的 `complete` 配伴奏；② MusicGen-melody 生成纯伴奏，再叠加用户人声。

### 能力 2：段落重绘
- **首选：ACE-Step 1.5 Repaint（2B turbo，不加载 LM）。** 文档完整（`repainting_start/end`，3–90 秒，可在区间内换歌词），MIT 许可，官方支持 Mac。
- **备选：DiffRhythm v1.2 `--edit --edit-segments`。**
- **“用新哼唱驱动某一段重绘”：没有候选在文档中支持。** 【推断】可以试的实验路径：
  - (a) 用 ACE-Step 1.5 Repaint，只换歌词和 caption，接受旋律由模型决定；
  - (b) 用 YuE2 改 ABC 谱中对应小节（把新哼唱转成谱后替换进去）再整首重渲染，然后**只截取目标段落**，用 ACE-Step Repaint 处理两侧边界（各 2–3 秒）让过渡自然；
  - (c) 把新哼唱拼进原歌对应位置，对这段做 ACE-Step Cover/Repaint 的组合。这个用法未被文档描述，需要读源码确认 `src_audio` + 重绘区间能否和 cover 同时使用。

---

## 6. 最小可行性测试计划

> 原则：分阶段进行；每阶段结束先记录结果再决定是否继续；每次只加载一个模型；磁盘不够时先清理上一阶段的权重。下文命令来自官方文档，执行前以仓库最新版本为准。**本文撰写时没有执行任何安装。**

### 6.0 准备（约 0.5 GB）
- 工具：`git`、`uv`（ACE-Step 官方推荐）、Homebrew `ffmpeg`（SheetSage2 要求 FFmpeg 6.1 共享库，Homebrew 上可能需要 `ffmpeg@6`，以实际为准）、`espeak-ng`（只有 DiffRhythm 需要）。
- 一个独立的分析环境（Python 3.10）：`librosa`、`mir_eval`、`soundfile`、`basic-pitch`（M1 只支持 3.10）、`demucs`（可选，用来从生成结果中分离人声做音高分析）。
- 内存监控：活动监视器的“内存压力”和“交换内存”；进程内用 `torch.mps.current_allocated_memory()` / `torch.mps.driver_allocated_memory()` 记录峰值。

### 6.1 测试输入（用户自行录制，44.1/48 kHz 单声道 WAV）
1. `hum_twinkle.wav`：哼《小星星》前 4 句，约 20 秒，节拍稳定（约 90 BPM）。**选已知旋律，是为了有标准 MIDI 作为客观参照。**
2. `hum_tigers.wav`：哼《两只老虎》约 15 秒，同样有标准参照。
3. `hum_original.wav`：哼一段原创旋律，约 20 秒（只做主观评估）。
4. `sing_twinkle_zh.wav`：用新的中文歌词清唱《小星星》旋律（用于测试 ACE-Step 的 `complete` 兜底方案）。
5. `lyrics_zh.txt`：中文歌词，带 `[Verse]` / `[Chorus]` 标记，音节数与旋律匹配（每句 7 字左右）。
6. `style.txt`：例如 “Mandarin pop, female vocal, piano, light drums, warm”。
7. 重绘源：阶段 A 中 ACE-Step 1.5 text2music 生成的 60 秒中文歌 `base_song.wav`。

### 6.2 阶段 A：ACE-Step 1.5（磁盘约 15–17 GB）
- 安装：`git clone https://github.com/ACE-Step/ACE-Step-1.5.git && cd ACE-Step-1.5 && uv sync`（Python 3.11–3.12），通过 `start_gradio_ui_macos.sh` 或 Python API 运行。
- 权重：主仓库 `ACE-Step/Ace-Step1.5` 10.09 GB（包含 turbo DiT 和 1.7B LM，首次运行自动下载）；可选 `acestep-5Hz-lm-0.6B` 1.37 GB。只有测 `complete` 时才需要 `acestep-v15-base` 4.79 GB。虚拟环境约 3–5 GB（【推断】）。
- 配置：`ACESTEP_CONFIG_PATH=acestep-v15-turbo`；cover/repaint 测试时**不初始化 LM**（环境变量名 `ACESTEP_INIT_LLM` 见 #1336 的环境配置，可选值以 `.env.example` 为准）；`PYTORCH_ENABLE_MPS_FALLBACK=1`；batch 设为 1；时长不超过 60 秒。Cover 测试时**关闭 MLX DiT**（#1346）。如果用 Base/SFT 模型，设置 `dcw_enabled=False, shift=1.0`（#1259）。
- 用例：
  - A1 冒烟测试：text2music，30 秒，中文歌词。
  - A2 生成重绘源：text2music，60 秒，得到 `base_song.wav`。
  - A3 Repaint：`task_type="repaint", src_audio=base_song.wav, repainting_start=20, repainting_end=35`，新歌词和 caption 只描述这一段。分别用 `chunk_mask_mode="explicit"` 和默认值各跑一次。
  - A4 Cover：`src_audio=hum_twinkle.wav`，配 `lyrics_zh.txt` 和 `style.txt`，`audio_cover_strength` 取 1.0 / 0.8 / 0.5 三档，每档 2 个 seed。
  - A5（可选，兜底）：Base 模型 `complete`，`src_audio=sing_twinkle_zh.wav`，instruction 为 “Complete the input track with piano, bass, drums:”。

### 6.3 阶段 B：YuE2 + SheetSage2（磁盘约 18–20 GB；如磁盘紧张，先删除阶段 A 中不需要的权重）
- 安装（两个独立环境）：
  - YuE2：Python 3.12，`python -m pip install .`；**把 torch 覆盖为 ≥2.13**（#176），否则 MPS BF16 结果不可信；`device="mps"`（或 `auto`）。
  - SheetSage2：Python 3.11，`huggingface-cli download m-a-p/SheetSage2`，`pip install -r requirements.txt`（Mac 上使用 PyPI 默认的 torch，不要用文档里的 cu126 源），用 CPU 或 MPS 运行。
- 权重：YuE2-3B 7.30 GB + YuE2-Vae 0.53 GB + SheetSage2 0.23 GB + MERT-v2-FullSong 2.53 GB ≈ 10.6 GB；可选社区适配器 `hum_adapter_v1_combined.safetensors` 0.42 GB。两个环境约 6–8 GB（【推断】）。
- 用例：
  - B1 冒烟测试：`examples/generate.py --request examples/song.json --abc-file examples/melody.abc --cot melody`，生成时长限制在 60 秒左右。验证 MPS 能跑、峰值内存是多少、耗时多久。
  - B2 哼唱转谱：`infer.py hum_twinkle.wav --output hum-score --melody-only`。人工检查 ABC 与《小星星》的音高和节奏是否一致；同时用 basic-pitch 输出 MIDI 做对照。
  - B3 哼唱成曲：`--abc-file hum-score/score.abc --cot melody`，配 `lyrics_zh.txt`（音节数对齐）和 `style.txt`，2 个 seed。
  - B4（可选）：社区适配器的 `scripts/hum_continue.py` / `infer_hum.py`（只有在 B3 能跑通后才做）。
  - B5（能力 2 实验路径 b）：改动 B3 谱子中的某几个小节后重新渲染，截取对应段落，再用 ACE-Step Repaint 修补两侧边界。

### 6.4 通过标准（阈值是本文提出的工程建议，不是任何官方基准）

| 维度 | 指标 | 通过线 |
|---|---|---|
| 可运行 | 在 MPS 上完成生成，没有 OOM，没有持续大量 swap（内存压力不进入红色） | 必须满足 |
| 内存 | MPS 驱动分配峰值 | ≤ 11 GB |
| 速度（30 秒片段） | 端到端耗时，不含首次加载 | ACE-Step ≤ 3 分钟；YuE2 ≤ 6 分钟 |
| 旋律跟随（能力 1） | 用 pyin 提取哼唱 f0；用 demucs 分离生成结果的人声后再提取 f0；做整体移调和 DTW 对齐后，计算 `mir_eval.melody` 的 Raw Pitch Accuracy（50 音分以内）；已知曲目再加 basic-pitch 转 MIDI 后与标准 MIDI 的 note onset F1 | RPA ≥ 0.6，且 note F1 ≥ 0.5；**另外 3 名听者盲听，至少 2 人能认出是《小星星》/《两只老虎》** |
| 歌词可懂度（能力 1、2） | 人工听写中文歌词，计算字准确率（可选：用 ASR 计算） | ≥ 80% |
| 重绘保真（能力 2） | 重绘区间外（两侧各排除 0.5 秒边界）与原音频的 SNR，或 log-mel L1 / 余弦相似度 | SNR ≥ 15 dB，或 mel 余弦 ≥ 0.98 |
| 重绘衔接 | 盲听边界处有无明显断裂、节拍是否错位 | 3 人中至少 2 人认为自然 |
| 重绘内容 | 区间内新歌词能听清，风格与 caption 相符 | 主观通过 |

判定规则：
- 能力 1：YuE2 路线达标即采用。如果只有 ACE-Step Cover 达标，也采用，但要注明它“无文档保证”。两者都不达标时，改用兜底方案（清唱 + `complete`，或 MusicGen-melody 伴奏）。
- 能力 2：ACE-Step Repaint 达标即采用；不达标再测 DiffRhythm v1.2 `--edit`。

### 6.5 磁盘预算

| 项目 | 估算 |
|---|---|
| 阶段 A（ACE-Step 1.5，不含 base） | 约 15 GB（含 base 约 20 GB） |
| 阶段 B（YuE2 体系） | 约 18–20 GB |
| 分析工具和测试音频 | 约 2–3 GB |
| 合计 | 约 35–43 GB |

可用磁盘约 50 GB，**能放下但余量很小**。建议把 Hugging Face 缓存集中到同一目录（`HF_HOME`）以便清理，阶段 B 之前清掉阶段 A 中不需要的模型（例如 1.7B LM）。

---

## 7. 尚未解决的问题

1. SheetSage2 对**哼唱**（而不是成品歌曲）的转谱准确率，没有官方评测。
2. ACE-Step 1.5 在 M1 Pro 上的实际速度和内存，以及 16GB 机器会被它的显存分级系统识别成哪一档，均未找到资料。
3. ACE-Step 1.5 的 cover 和 repaint 能否在同一次调用中组合使用（“用新哼唱驱动区间重绘”），需要读源码确认。
4. YuE2 在 torch ≥2.13 上与官方锁定版本是否存在其他不兼容，目前只有一份用户报告。
5. 许可：如果这个“个人 AI 音乐 App”将来要对外分发或商业化，YuE2、SheetSage2、MERT-v2、哼唱适配器、MuQ-MuLan、MusicGen、MuLaCover 的权重都带非商用条款或需要额外授权；ACE-Step 1.5（MIT）和 DiffRhythm 主体（Apache-2.0）限制最少。

---

## 8. 来源汇总

- ACE-Step 1.5：https://github.com/ace-step/ACE-Step-1.5 （README、docs/en/Tutorial.md、INFERENCE.md、GPU_COMPATIBILITY.md、INSTALL.md、BENCHMARK.md、GRADIO_GUIDE.md）；issues #972、#1100、#1259、#1336、#1346；https://huggingface.co/ACE-Step/Ace-Step1.5 ；https://arxiv.org/abs/2602.00744
- ACE-Step v1：https://github.com/ace-step/ACE-Step ；https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B
- YuE2：https://github.com/multimodal-art-projection/YuE （README、docs/covers.md、generation.md、editing.md）；issue #176；https://huggingface.co/m-a-p/YuE2-3B ；https://huggingface.co/m-a-p/SheetSage2 ；https://arxiv.org/abs/2609.33757 ；https://arxiv.org/abs/2610.05336
- YuE2 哼唱适配器（社区）：https://huggingface.co/Mothersuperior/YuE2-hum-to-song
- YuE v1：https://github.com/multimodal-art-projection/YuE/tree/YuE-v1 ；issues #13、#51
- DiffRhythm：https://github.com/ASLP-lab/DiffRhythm （README、infer/infer.py）；issues #68、#114；DiffRhythm 2：https://github.com/xiaomi-research/diffrhythm2 ；https://huggingface.co/ASLP-lab/DiffRhythm2
- SongBloom：https://huggingface.co/rtikw/SongBloom （镜像，含删除说明）；https://arxiv.org/abs/2506.07634
- LeVo / SongGeneration：https://github.com/tencent-ailab/SongGeneration （当前 404，内容来自搜索快照）；https://huggingface.co/lglg666/SongGeneration-v2-large ；https://huggingface.co/mlx-community/SongGeneration-v2-large ；https://postcutoff.com/m/songgeneration-2/ ；https://pinokio.co/posts/01ky99xzcwnchnsqws0ps2mbes
- HeartMuLa / MuLaCover：https://github.com/HeartMuLa/heartlib （issues #56、#85）；https://github.com/HeartMuLa/MuLaCover ；https://huggingface.co/HeartMuLa/MuLaCover
- MiniMax Music 3：https://huggingface.co/MiniMaxAI/MiniMax-Music3 ；https://docs.comfy.org/tutorials/audio/minimax/minimax-music-3 ；https://support.comfy.org/articles/6065098425-minimax-commercial-licensing-who-needs-a-license-and-how-to-get-one
- MusicGen：https://github.com/facebookresearch/audiocraft/blob/main/docs/MUSICGEN.md ；https://github.com/facebookresearch/audiocraft/blob/main/model_cards/MUSICGEN_MODEL_CARD.md ；https://huggingface.co/facebook/musicgen-melody
- Stable Audio Open：https://huggingface.co/stabilityai/stable-audio-open-1.0 ；https://github.com/Stability-AI/stable-audio-tools ；MIDI-SAG：https://github.com/fundwotsai2001/MIDI-SAG
- 预处理工具：https://github.com/spotify/basic-pitch ；https://github.com/maxrmorrison/torchcrepe ；https://github.com/librosa/librosa
- 社区 Mac 移植参考：https://github.com/techfreakworm/ace-music-studio （ACE-Step 1.5 XL 在 Apple Silicon 上运行，作者建议 128GB 统一内存）
