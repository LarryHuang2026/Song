"use client";
import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  KeyRound,
  Check,
  LoaderCircle,
  AudioLines,
  RotateCcw,
  Download,
  Settings2,
} from "lucide-react";
import type { Hum, LocalVersion } from "./local-studio";
import type { AiJob, AiRequest } from "@/lib/ai-domain";
type Settings = {
  configured: boolean;
  verifiedAt: string | null;
  source: string;
  balance?: number;
};
type Project = {
  id: string;
  name: string;
  archivedAt: string | null;
  selectedVersionId: string | null;
  lyricsDraft: string;
  promptDraft: string;
  hums: Hum[];
  versions: LocalVersion[];
  jobs: AiJob[];
};
const names: Record<string, string> = {
  queued: "排队中",
  uploading: "上传源音频",
  submitting: "提交 AI 生成",
  running: "AI 正在创作",
  downloading: "下载 / 本地重建",
  succeeded: "已完成",
  failed: "失败",
  unknown_submission: "提交结果未知",
  poll_failed: "查询已暂停",
  download_failed: "保存未完成",
  cancelled: "已取消",
};
async function api<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${url}`, {
    cache: "no-store",
    ...(body
      ? {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "请求未完成");
  return json;
}
function ProviderSettings({
  onChange,
}: {
  onChange: (settings: Settings) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null),
    [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    void api<Settings>("ai/config")
      .then((s) => {
        if (live) {
          setSettings(s);
          onChange(s);
        }
      })
      .catch(() => {
        if (live) setMessage("无法读取服务配置，请刷新重试");
      });
    return () => {
      live = false;
    };
  }, [onChange]);
  async function configure(action: "save" | "verify" | "clear") {
    setBusy(true);
    setMessage("");
    try {
      const value = await api<Settings>("ai/config", {
        action,
        ...(key.trim() && action !== "clear" ? { apiKey: key.trim() } : {}),
      });
      setSettings(value);
      onChange(value);
      setKey("");
      setMessage(
        action === "verify"
          ? `鉴权已通过，余额 ¥${value.balance?.toFixed(2)}。生成效果仍需实测。`
          : action === "clear"
            ? "本机 AI Key 已清除"
            : "Key 已保存，可以提交实验任务；尚未验证服务连接。",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel ai-settings" id="ai-provider-settings">
      <div className="panel-title">
        <span className="heading-icon">
          <KeyRound size={18} />
        </span>
        <h2>AI 服务配置</h2>
        <span
          className={`pill ${settings?.configured ? "quiet" : "demo-pill"}`}
        >
          {settings?.configured
            ? settings.verifiedAt
              ? "已配置 · 鉴权已验证"
              : "已配置 · 未检测连接"
            : "待填写 Key"}
        </span>
      </div>
      <p className="local-description">
        音频参考生成与段落重写使用{" "}
        <a href="https://www.suno-api.io/" target="_blank" rel="noreferrer">
          suno-api.io
        </a>
        ，需要该服务独立的 Key。现有 FluxPort Key 继续用于文字创作。
      </p>
      <label htmlFor="suno-api-key">Suno-API Key</label>
      <input
        id="suno-api-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={
          settings?.configured
            ? "已保存；留空使用当前 Key"
            : "粘贴 suno-api.io 的 API Key"
        }
        maxLength={512}
      />
      <div className="settings-actions">
        <button
          className="button primary"
          disabled={busy || (!key.trim() && !settings?.configured)}
          onClick={() => void configure("verify")}
        >
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Check size={14} />
          )}
          保存并检测连接
        </button>
        <button
          className="button secondary"
          disabled={busy || !key.trim()}
          onClick={() => void configure("save")}
        >
          仅保存 Key
        </button>
        <button
          className="text-button"
          disabled={busy || !settings?.configured}
          onClick={() => void configure("clear")}
        >
          清除 Key
        </button>
      </div>
      {message && (
        <p className="settings-message" role="status">
          {message}
        </p>
      )}
      <p className="hint">
        Key
        仅保存在本机私有配置中，不写入浏览器存储；连接检测只查询余额，不生成音乐。配置立即生效，无需重启。
      </p>
    </section>
  );
}
export default function AiStudio({
  project,
  kind,
  refresh,
  navigate,
  onLockChange,
}: {
  project: Project;
  kind: AiRequest["kind"];
  refresh: () => Promise<unknown>;
  navigate: (mode: "hums" | "create") => void;
  onLockChange: (locked: boolean) => void;
}) {
  const cover = kind === "hum_cover";
  const [settings, setSettings] = useState<Settings | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [sourceId, setSourceId] = useState(
    cover
      ? project.hums[0]?.id || ""
      : project.selectedVersionId || project.versions[0]?.id || "",
  );
  const [title, setTitle] = useState(project.name),
    [style, setStyle] = useState(() => {
      try {
        return (
          JSON.parse(project.promptDraft).style || "中文流行，钢琴与木吉他"
        );
      } catch {
        return "中文流行，钢琴与木吉他";
      }
    });
  const [model, setModel] = useState("suno-v6"),
    [lyrics, setLyrics] = useState(project.lyricsDraft),
    [description, setDescription] = useState(
      "保留参考旋律的走向，创作有完整结构的歌曲",
    ),
    [weight, setWeight] = useState(0.7),
    [instrumental, setInstrumental] = useState(false);
  const [start, setStart] = useState(0),
    [end, setEnd] = useState(10),
    [windowLyrics, setWindowLyrics] = useState(""),
    [infillLyrics, setInfillLyrics] = useState(""),
    [fade, setFade] = useState(30);
  const pending = useRef<{ fingerprint: string; id: string } | null>(null);
  const sources = cover ? project.hums : project.versions,
    selected = sources.find((s) => s.id === sourceId);
  const jobs = project.jobs.filter((j) => {
    try {
      return (
        j.provider === "suno-api" && JSON.parse(j.requestParams).kind === kind
      );
    } catch {
      return false;
    }
  });
  const versions = project.versions.filter(
    (v) => v.sourceType === (cover ? "hum_generate" : "section_edit"),
  );
  useEffect(() => {
    onLockChange(busy);
    return () => onLockChange(false);
  }, [busy, onLockChange]);
  useEffect(() => {
    if (!cover && selected) {
      setStart(0);
      setEnd(Math.min(10, selected.durationSec));
    }
  }, [sourceId, cover]);
  const invalid =
    !sourceId ||
    !title.trim() ||
    !style.trim() ||
    (!cover &&
      (!lyrics.trim() ||
        end - start < 2 ||
        end > (selected?.durationSec || 0))) ||
    (cover && !description.trim());
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const request = cover
        ? {
            kind,
            model,
            title,
            style,
            humId: sourceId,
            lyrics,
            description,
            instrumental,
            audioWeight: weight,
          }
        : {
            kind,
            model,
            title,
            style,
            baseVersionId: sourceId,
            startSec: start,
            endSec: end,
            contextLyrics: lyrics,
            infillLyrics,
            contextWindowLyrics: windowLyrics,
            crossfadeMs: fade,
          };
      const fingerprint = JSON.stringify(request);
      if (pending.current?.fingerprint !== fingerprint)
        pending.current = { fingerprint, id: crypto.randomUUID() };
      await api(`projects/${project.id}/ai-jobs`, {
        ...request,
        clientRequestId: pending.current.id,
      });
      pending.current = null;
      setNotice(
        "AI 任务已加入队列，可在下方跟踪进度。关闭页面不会停止后台任务。",
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      if (!settings?.configured)
        document.getElementById("suno-api-key")?.focus();
    } finally {
      setBusy(false);
    }
  }
  async function recover(job: AiJob, action: string) {
    setBusy(true);
    setError("");
    try {
      await api(`jobs/${job.id}/${action}`, {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="ai-studio">
      <div className="banner ai-experimental">
        <Sparkles size={17} />
        <span>
          {cover
            ? "实验功能：上传哼唱作为音频参考生成完整歌曲。模型可能改变旋律，实际遵循度尚未验证。"
            : "实验功能：按歌词与风格重写选定段落，再在本地重建。此模式不使用额外哼唱约束替换旋律。"}
        </span>
        <span className="pill">实验性开放</span>
      </div>
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="banner ai-success" role="status">
          {notice}
        </div>
      )}
      <div className="ai-grid">
        <section className="panel ai-form">
          <div className="panel-title">
            <span className="heading-icon">
              <AudioLines size={18} />
            </span>
            <h2>{cover ? "AI 哼唱成曲" : "AI 段落重写"}</h2>
          </div>
          <form onSubmit={submit}>
            <fieldset disabled={busy || !!project.archivedAt}>
              <div className="field">
                <label htmlFor="ai-source">
                  {cover ? "参考哼唱" : "原曲版本"}
                </label>
                <select
                  id="ai-source"
                  required
                  value={sourceId}
                  onChange={(e) => setSourceId(e.target.value)}
                >
                  <option value="">
                    {cover ? "请选择已保存的哼唱" : "请选择歌曲版本"}
                  </option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} · {s.durationSec.toFixed(2)} 秒
                    </option>
                  ))}
                </select>
                {!sources.length && (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => navigate(cover ? "hums" : "create")}
                  >
                    {cover ? "先录音或上传哼唱 →" : "先生成或导入歌曲 →"}
                  </button>
                )}
              </div>
              {selected && (
                <audio
                  className="ai-source-player"
                  controls
                  preload="none"
                  src={
                    cover
                      ? `/api/hums/${sourceId}/audio`
                      : `/api/audio/${sourceId}`
                  }
                  aria-label="AI 源音频试听"
                  onPlay={(event) => {
                    document.querySelectorAll("audio").forEach((a) => {
                      if (a !== event.currentTarget) a.pause();
                    });
                  }}
                />
              )}
              <div className="two-columns">
                <div className="field">
                  <label htmlFor="ai-title">作品标题</label>
                  <input
                    id="ai-title"
                    required
                    maxLength={100}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="ai-model">AI 模型</label>
                  <select
                    id="ai-model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option>suno-v6</option>
                    <option>suno-v6-wild</option>
                    <option>suno-v6-mini</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="ai-style">音乐风格</label>
                <input
                  id="ai-style"
                  required
                  maxLength={1000}
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                />
              </div>
              {cover ? (
                <>
                  <div className="field">
                    <label htmlFor="ai-description">创作要求</label>
                    <textarea
                      id="ai-description"
                      required
                      maxLength={2000}
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                    <p className="hint">
                      填写歌词时，服务使用歌词作为主提示；创作要求只在歌词留空时生效。
                    </p>
                  </div>
                  <div className="field">
                    <div className="label-row">
                      <label htmlFor="ai-weight">参考音频影响权重</label>
                      <span>{weight.toFixed(2)}</span>
                    </div>
                    <input
                      id="ai-weight"
                      type="range"
                      min="0"
                      max="1"
                      step=".05"
                      value={weight}
                      onChange={(e) => setWeight(Number(e.target.value))}
                    />
                  </div>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={instrumental}
                      onChange={(e) => setInstrumental(e.target.checked)}
                    />
                    生成纯音乐
                  </label>
                </>
              ) : (
                <>
                  <div className="edit-time-fields">
                    <div className="field">
                      <label htmlFor="ai-start">AI 开始时间（秒）</label>
                      <input
                        id="ai-start"
                        type="number"
                        min="0"
                        step=".01"
                        value={start}
                        onChange={(e) => setStart(Number(e.target.value))}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ai-end">AI 结束时间（秒）</label>
                      <input
                        id="ai-end"
                        type="number"
                        min="2"
                        max={selected?.durationSec || 0}
                        step=".01"
                        value={end}
                        onChange={(e) => setEnd(Number(e.target.value))}
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ai-fade">衔接淡化（毫秒）</label>
                      <input
                        id="ai-fade"
                        type="number"
                        min="0"
                        max="1000"
                        step="1"
                        value={fade}
                        onChange={(e) => setFade(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <p className="hint">
                    选区至少 2 秒。原曲最长 10 分钟 / 50 MB。最终输出浮点
                    WAV，选区外保留同采样率解码后的原曲。
                  </p>
                </>
              )}
              <div className="field ai-lyrics">
                <label htmlFor="ai-lyrics">
                  {cover ? "歌词（可留空）" : "整首歌词上下文"}
                </label>
                <textarea
                  id="ai-lyrics"
                  required={!cover}
                  maxLength={8000}
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  placeholder={
                    cover
                      ? "留空时按创作要求生成；歌词内容可能影响旋律遵循。"
                      : "填写整首歌词，供服务定位和重写段落。"
                  }
                />
              </div>
              {!cover && (
                <>
                  <div className="field">
                    <label htmlFor="ai-window">选区前后歌词（可留空）</label>
                    <textarea
                      id="ai-window"
                      maxLength={4000}
                      value={windowLyrics}
                      onChange={(e) => setWindowLyrics(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ai-infill">替换段的新歌词</label>
                    <textarea
                      id="ai-infill"
                      maxLength={4000}
                      value={infillLyrics}
                      onChange={(e) => setInfillLyrics(e.target.value)}
                    />
                  </div>
                </>
              )}
            </fieldset>
            <p className="ai-cost">
              选中音频会上传至 suno-api.io。文档参考价约 ¥0.60 /
              次，实际以服务商扣费为准。
            </p>
            <button
              className="button primary generate-button"
              type="submit"
              disabled={busy || invalid || !!project.archivedAt}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {cover ? "开始 AI 哼唱成曲" : "开始 AI 段落重写"}
            </button>
            {!settings?.configured && (
              <p className="hint">
                请在右侧填写新服务的 Key。入口已开放，当前尚未连接生成服务。
              </p>
            )}
          </form>
        </section>
        <aside className="ai-side">
          <ProviderSettings onChange={setSettings} />
          <section className="ai-task-list">
            <h2 className="local-section-title">
              AI 任务 <span>{jobs.length}</span>
            </h2>
            {!jobs.length && (
              <div className="panel ai-task-empty">
                <Settings2 size={23} />
                <p>配置服务并选择素材后，即可提交实验任务。</p>
              </div>
            )}
            {jobs.map((job) => (
              <article className="panel job-card" key={job.id}>
                <div className="job-heading">
                  <strong>{JSON.parse(job.requestParams).title}</strong>
                  <span className={`job-status status-${job.status}`}>
                    {[
                      "uploading",
                      "submitting",
                      "running",
                      "downloading",
                    ].includes(job.status) && (
                      <LoaderCircle size={12} className="spin" />
                    )}
                    {names[job.status] || job.status}
                  </span>
                </div>
                {job.outputs.map((output) => (
                  <div className="output-progress" key={output.id}>
                    <div>
                      <span>候选 {output.index + 1}</span>
                      <span>
                        {output.status === "completed"
                          ? "已保存"
                          : output.status === "generation_failed"
                            ? "生成失败"
                            : output.status === "failed"
                              ? "保存失败"
                              : output.status === "postprocessing"
                                ? "本地重建"
                                : output.totalBytes
                                  ? `${Math.round((output.receivedBytes / output.totalBytes) * 100)}%`
                                  : output.status === "pending"
                                    ? "等待生成"
                                    : `${(output.receivedBytes / 1048576).toFixed(1)} MB`}
                      </span>
                    </div>
                    <progress
                      value={
                        output.status === "completed"
                          ? 1
                          : output.totalBytes
                            ? output.receivedBytes / output.totalBytes
                            : 0
                      }
                      max="1"
                    />
                    {output.errorMessage && (
                      <p className="job-error">{output.errorMessage}</p>
                    )}
                  </div>
                ))}
                {job.errorMessage && (
                  <p className="job-error">{job.errorMessage}</p>
                )}
                <div className="job-actions">
                  {job.status === "poll_failed" && (
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => void recover(job, "resume-query")}
                    >
                      <RotateCcw size={13} />
                      继续查询 · 不重新生成
                    </button>
                  )}
                  {job.status === "download_failed" && (
                    <button
                      className="button secondary small"
                      disabled={busy}
                      onClick={() => void recover(job, "retry-download")}
                    >
                      <RotateCcw size={13} />
                      恢复保存 · 不重新生成
                    </button>
                  )}
                  {job.status === "queued" && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => void recover(job, "cancel")}
                    >
                      取消排队
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
          <section className="ai-result-list">
            <h2 className="local-section-title">
              生成结果 <span>{versions.length}</span>
            </h2>
            {versions.map((v) => (
              <article className="panel ai-result" key={v.id}>
                <div className="version-title">
                  <h3>{v.label}</h3>
                  <span className="pill">实验结果</span>
                </div>
                <p className="hint">
                  {cover
                    ? "API 音频参考 · 旋律遵循度待评估"
                    : "API 文字重写 + 本地选区重建"}{" "}
                  · {v.durationSec.toFixed(2)} 秒
                </p>
                <audio
                  controls
                  preload="none"
                  src={`/api/audio/${v.id}`}
                  aria-label={`AI 结果 ${v.label}`}
                  onPlay={(event) => {
                    document.querySelectorAll("audio").forEach((a) => {
                      if (a !== event.currentTarget) a.pause();
                    });
                  }}
                />
                <div className="version-actions">
                  <a
                    className="text-button"
                    href={`/api/audio/${v.id}?download=1`}
                  >
                    <Download size={13} />
                    下载候选
                  </a>
                  <span className="hint">
                    可在“文字创作”的版本列表设为选定版本
                  </span>
                </div>
              </article>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
