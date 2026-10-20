"use client";
import { useEffect, useRef, useState } from "react";
import {
  Mic,
  Pause,
  Play,
  Square,
  Upload,
  Download,
  Check,
  Scissors,
  LoaderCircle,
  RotateCcw,
  AudioLines,
} from "lucide-react";
import type { MelodyAnalysis } from "@/lib/local-audio";

export type Hum = {
  id: string;
  label: string;
  durationSec: number;
  originalDurationSec: number;
  peaks: string;
  analysisJson: string;
  processingJson: string;
  createdAt: string;
};
export type LocalVersion = {
  id: string;
  label: string;
  durationSec: number;
  peaks: string;
  parentVersionId: string | null;
  sourceType: string;
  paramsSnapshot: string;
};
type LocalProject = {
  id: string;
  archivedAt: string | null;
  selectedVersionId: string | null;
  versions: LocalVersion[];
  hums: Hum[];
};
const secondsLabel = (value: number) =>
  `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${url}`, {
    method: body ? "POST" : "GET",
    ...(body instanceof FormData
      ? { body }
      : body
        ? {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
          }
        : {}),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "本地处理失败");
  return result;
}
function solo(event: React.SyntheticEvent<HTMLAudioElement>) {
  document.querySelectorAll("audio").forEach((audio) => {
    if (audio !== event.currentTarget) audio.pause();
  });
}
function PitchChart({
  analysis,
  duration,
}: {
  analysis: MelodyAnalysis;
  duration: number;
}) {
  const pitches = analysis.pitch
    .filter((p) => p.hz !== null)
    .map((p) => 69 + 12 * Math.log2(p.hz! / 440));
  const min = pitches.length ? Math.floor(Math.min(...pitches)) - 2 : 48,
    max = pitches.length ? Math.ceil(Math.max(...pitches)) + 2 : 72;
  const note = (midi: number) =>
    ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][
      ((midi % 12) + 12) % 12
    ] +
    (Math.floor(midi / 12) - 1);
  const rows = Array.from({ length: 5 }, (_, i) =>
    Math.round(min + ((max - min) * i) / 4),
  );
  return (
    <div className="pitch-chart">
      <svg role="img" aria-label="哼唱音高曲线" viewBox="0 0 800 180">
        {rows.map((midi, i) => (
          <g key={i}>
            <line
              x1="36"
              x2="788"
              y1={150 - ((midi - min) / (max - min)) * 130}
              y2={150 - ((midi - min) / (max - min)) * 130}
              stroke="#e9eade"
            />
            <text
              x="0"
              y={154 - ((midi - min) / (max - min)) * 130}
              fontSize="10"
              fill="#929b84"
            >
              {note(midi)}
            </text>
          </g>
        ))}
        {analysis.pitch.map((p, i) => {
          const previous = analysis.pitch[i - 1];
          if (
            !p.hz ||
            !previous?.hz ||
            Math.abs(Math.log2(p.hz / previous.hz)) > 0.3
          )
            return null;
          return (
            <line
              key={i}
              x1={36 + (previous.timeSec / duration) * 752}
              x2={36 + (p.timeSec / duration) * 752}
              y1={
                150 -
                ((69 + 12 * Math.log2(previous.hz / 440) - min) / (max - min)) *
                  130
              }
              y2={
                150 -
                ((69 + 12 * Math.log2(p.hz / 440) - min) / (max - min)) * 130
              }
              stroke="#c78860"
              strokeWidth="2"
              strokeLinecap="round"
            />
          );
        })}
        <text x="36" y="175" fontSize="10" fill="#929b84">
          0 秒
        </text>
        <text x="740" y="175" fontSize="10" fill="#929b84">
          {duration.toFixed(1)} 秒
        </text>
      </svg>
      {!pitches.length && (
        <span className="pitch-empty">
          未识别到稳定音高，原始音频仍可试听。
        </span>
      )}
    </div>
  );
}
function Recorder({
  disabled,
  onPreview,
  onError,
  onState,
}: {
  disabled: boolean;
  onPreview: (file: File) => void;
  onError: (message: string) => void;
  onState: (active: boolean) => void;
}) {
  const [status, setStatus] = useState<
    "idle" | "requesting" | "recording" | "paused"
  >("idle");
  const [elapsed, setElapsed] = useState(0),
    [level, setLevel] = useState<number[]>(Array(50).fill(0.02));
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null),
    context = useRef<AudioContext | null>(null);
  const animation = useRef(0),
    live = useRef(true),
    clock = useRef({ total: 0, started: 0 }),
    chunks = useRef<Blob[]>([]);
  const epoch = useRef(0);
  function release() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    cancelAnimationFrame(animation.current);
    void context.current?.close().catch(() => {});
    context.current = null;
  }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      epoch.current++;
      if (recorder.current && recorder.current.state !== "inactive")
        recorder.current.stop();
      release();
      onState(false);
    };
  }, [onState]);
  useEffect(() => {
    onState(status !== "idle");
    if (status !== "recording") return;
    const timer = setInterval(() => {
      const seconds =
        (clock.current.total + performance.now() - clock.current.started) /
        1000;
      setElapsed(seconds);
      if (seconds >= 175) recorder.current?.stop();
    }, 100);
    return () => clearInterval(timer);
  }, [status, onState]);
  async function start() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      onError(
        "当前浏览器不支持录音，请使用 Chrome 并允许麦克风，或上传已有音频。",
      );
      return;
    }
    const token = ++epoch.current;
    setStatus("requesting");
    onError("");
    try {
      const input = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      if (!live.current || token !== epoch.current) {
        input.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = input;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const media = new MediaRecorder(
        input,
        mimeType ? { mimeType } : undefined,
      );
      recorder.current = media;
      chunks.current = [];
      media.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      media.onerror = () => {
        release();
        if (live.current) {
          setStatus("idle");
          onError("录音设备发生错误，请重录或改用文件上传。");
        }
      };
      media.onstop = () => {
        release();
        if (!live.current) return;
        setStatus("idle");
        const blob = new Blob(chunks.current, { type: media.mimeType });
        if (blob.size) {
          const ext = /mp4/.test(media.mimeType)
            ? "m4a"
            : /ogg/.test(media.mimeType)
              ? "ogg"
              : "webm";
          onPreview(
            new File(
              [blob],
              `哼唱-${new Date().toISOString().replace(/[:.]/g, "-")}.${ext}`,
              { type: media.mimeType },
            ),
          );
        }
      };
      media.start(250);
      clock.current = { total: 0, started: performance.now() };
      setElapsed(0);
      setStatus("recording");
      try {
        const audioContext = new AudioContext();
        context.current = audioContext;
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 1024;
        audioContext.createMediaStreamSource(input).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const draw = () => {
          analyser.getByteTimeDomainData(data);
          const values = Array.from(
            { length: 50 },
            (_, i) =>
              Math.abs(data[Math.floor((i * data.length) / 50)] - 128) / 128,
          );
          setLevel(values);
          animation.current = requestAnimationFrame(draw);
        };
        draw();
      } catch {
        /* Recording remains usable when the optional live waveform fails. */
      }
    } catch (error) {
      if (!live.current || token !== epoch.current) return;
      release();
      setStatus("idle");
      onError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "麦克风权限被拒绝。请在地址栏的网站权限中允许麦克风，然后重试；也可以上传文件。"
          : "无法打开麦克风，请检查设备占用或使用文件上传。",
      );
    }
  }
  function togglePause() {
    const media = recorder.current;
    if (!media) return;
    if (media.state === "recording") {
      media.pause();
      clock.current.total += performance.now() - clock.current.started;
      setStatus("paused");
    } else if (media.state === "paused") {
      media.resume();
      clock.current.started = performance.now();
      setStatus("recording");
    }
  }
  return (
    <div className="recorder-box">
      <div className="live-wave" aria-label="麦克风实时波形">
        {level.map((value, i) => (
          <span key={i} style={{ height: `${Math.max(3, value * 58)}px` }} />
        ))}
      </div>
      <div className="recording-clock">
        <span className={status === "recording" ? "recording-dot" : ""} />
        {secondsLabel(elapsed)}
        <small>最长 175 秒 · 暂停时间不计入</small>
      </div>
      <div className="recorder-controls">
        {status === "idle" ? (
          <button
            className="button primary"
            disabled={disabled}
            onClick={() => void start()}
          >
            <Mic size={16} />
            开始录音
          </button>
        ) : status === "requesting" ? (
          <>
            <span className="hint">等待麦克风授权…</span>
            <button
              className="button secondary"
              onClick={() => {
                epoch.current++;
                setStatus("idle");
              }}
            >
              取消等待
            </button>
          </>
        ) : (
          <>
            <button className="button secondary" onClick={togglePause}>
              {status === "paused" ? <Play size={14} /> : <Pause size={14} />}
              {status === "paused" ? "继续录音" : "暂停录音"}
            </button>
            <button
              className="button primary"
              onClick={() => recorder.current?.stop()}
            >
              <Square size={14} />
              停止录音
            </button>
          </>
        )}
      </div>
    </div>
  );
}
function HumWorkspace({
  project,
  busy,
  setBusy,
  refresh,
  setError,
  onLockChange,
}: {
  project: LocalProject;
  busy: boolean;
  setBusy: (b: boolean) => void;
  refresh: () => Promise<unknown>;
  setError: (s: string) => void;
  onLockChange: (b: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  const [trimSilence, setTrimSilence] = useState(true),
    [normalize, setNormalize] = useState(true),
    [recording, setRecording] = useState(false),
    [unsavedRecording, setUnsavedRecording] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    onLockChange(busy || recording || unsavedRecording);
    return () => onLockChange(false);
  }, [busy, recording, unsavedRecording, onLockChange]);
  useEffect(() => {
    const prevent = (e: BeforeUnloadEvent) => {
      if (recording || unsavedRecording) e.preventDefault();
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [recording, unsavedRecording]);
  async function save() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("trimSilence", String(trimSilence));
      form.set("normalize", String(normalize));
      await request(`projects/${project.id}/hums`, form);
      setFile(null);
      setUnsavedRecording(false);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="local-layout">
      <section className="panel local-input">
        <div className="panel-title">
          <span className="heading-icon">
            <Mic size={18} />
          </span>
          <h2>记录你的旋律</h2>
        </div>
        <p className="local-description">
          轻轻哼唱一段旋律，录音只保存在这台电脑上。
        </p>
        <Recorder
          disabled={busy || !!project.archivedAt || unsavedRecording}
          onPreview={(value) => {
            setFile(value);
            setUnsavedRecording(true);
          }}
          onError={setError}
          onState={setRecording}
        />
        <div className="local-or">或使用已有音频</div>
        <button
          className="button secondary upload-hum"
          disabled={
            busy || recording || unsavedRecording || !!project.archivedAt
          }
          onClick={() => input.current?.click()}
        >
          <Upload size={15} />
          上传哼唱音频
        </button>
        <input
          ref={input}
          type="file"
          className="hidden-input"
          aria-label="上传哼唱文件"
          accept=".wav,.mp3,.m4a,.flac,.webm,.ogg"
          onChange={(e) => {
            const next = e.target.files?.[0];
            if (next) {
              setFile(next);
              setUnsavedRecording(false);
            }
            e.target.value = "";
          }}
        />
        <p className="hint">
          最长 180 秒 / 50 MB；支持浏览器录音、WAV、MP3、M4A、FLAC、OGG。
        </p>
        <div className="local-options">
          <label>
            <input
              type="checkbox"
              checked={trimSilence}
              onChange={(e) => setTrimSilence(e.target.checked)}
            />
            裁剪首尾静音（保留 50 ms 余量）
          </label>
          <label>
            <input
              type="checkbox"
              checked={normalize}
              onChange={(e) => setNormalize(e.target.checked)}
            />
            响度归一化（约 −20 dBFS RMS，峰值保护）
          </label>
        </div>
        {preview && (
          <div className="recording-preview">
            <strong>{file?.name}</strong>
            <audio controls src={preview} aria-label="录音预览" onPlay={solo} />
            <div className="recorder-controls">
              <button
                className="button primary"
                disabled={busy || !!project.archivedAt}
                onClick={() => void save()}
              >
                {busy ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Check size={15} />
                )}
                保存并分析
              </button>
              <a
                className="button secondary"
                href={preview}
                download={file?.name}
                onClick={() => setUnsavedRecording(false)}
              >
                <Download size={14} />
                下载原始录音
              </a>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setUnsavedRecording(false);
                }}
              >
                丢弃预览
              </button>
            </div>
          </div>
        )}
        <div className="banner warning local-honesty">
          <AudioLines size={16} />
          <span>
            录音和分析在本机完成。切换到“AI
            哼唱成曲”并提交任务后，才会将选中的音频上传给生成服务。
          </span>
        </div>
      </section>
      <section className="hum-library">
        <h2 className="local-section-title">
          哼唱素材 <span>{project.hums.length}</span>
        </h2>
        {!project.hums.length && (
          <div className="panel results-empty">
            <Mic size={30} />
            <h3>先留下一段旋律。</h3>
            <p>保存后可试听原始录音、标准 WAV 和音高曲线。</p>
          </div>
        )}
        {project.hums.map((hum) => {
          const analysis = JSON.parse(hum.analysisJson) as MelodyAnalysis,
            processing = JSON.parse(hum.processingJson);
          return (
            <article className="panel hum-card" key={hum.id}>
              <div className="version-title">
                <h3>{hum.label}</h3>
                <span className="pill quiet">本地处理</span>
              </div>
              <div className="hum-stats">
                <span>{hum.durationSec.toFixed(2)} 秒 · 44.1 kHz 单声道</span>
                <span>
                  可识别旋律 {Math.round(analysis.voicedRatio * 100)}%
                </span>
                <span>
                  {analysis.bpm
                    ? `参考速度 ${analysis.bpm} BPM`
                    : "未检测到可靠速度"}
                </span>
              </div>
              <PitchChart analysis={analysis} duration={hum.durationSec} />
              <p className="hint">{analysis.note}</p>
              {analysis.warnings.map((warning, i) => (
                <p className="analysis-warning" key={i}>
                  {warning}
                </p>
              ))}
              <div className="hum-players">
                <div>
                  <label>
                    原始哼唱 · {hum.originalDurationSec.toFixed(2)} 秒
                  </label>
                  <audio
                    controls
                    preload="none"
                    src={`/api/hums/${hum.id}/audio?original=1`}
                    aria-label={`原始哼唱 ${hum.label}`}
                    onPlay={solo}
                  />
                </div>
                <div>
                  <label>标准化 WAV</label>
                  <audio
                    controls
                    preload="none"
                    src={`/api/hums/${hum.id}/audio`}
                    aria-label={`标准化哼唱 ${hum.label}`}
                    onPlay={solo}
                  />
                </div>
              </div>
              <p className="hint">
                首部裁剪 {processing.trimStartSec.toFixed(2)} 秒 · 尾部裁剪{" "}
                {processing.trimEndSec.toFixed(2)} 秒 · 增益{" "}
                {processing.gainDb.toFixed(1)} dB；原始文件始终保留。
              </p>
              <div className="version-actions">
                <a
                  className="text-button"
                  href={`/api/hums/${hum.id}/audio?download=1`}
                >
                  <Download size={13} />
                  下载标准 WAV
                </a>
                <a
                  className="text-button"
                  href={`/api/hums/${hum.id}/audio?original=1&download=1`}
                >
                  <Download size={13} />
                  下载原始音频
                </a>
                <button
                  className="text-button"
                  disabled={busy || !!project.archivedAt}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await request(`hums/${hum.id}/reprocess`, {
                        trimSilence,
                        normalize,
                      });
                      await refresh();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <RotateCcw size={13} />
                  按左侧选项另存处理
                </button>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function LocalEditor({
  project,
  initialBaseId,
  refresh,
  busy,
  setBusy,
  setError,
}: {
  project: LocalProject;
  initialBaseId?: string;
  refresh: () => Promise<unknown>;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setError: (s: string) => void;
}) {
  const [baseId, setBaseId] = useState(
      initialBaseId ||
        project.selectedVersionId ||
        project.versions[0]?.id ||
        "",
    ),
    [source, setSource] = useState("");
  const [start, setStart] = useState(0),
    [end, setEnd] = useState(1),
    [offset, setOffset] = useState(0),
    [fade, setFade] = useState(30),
    [match, setMatch] = useState(false);
  const [resultId, setResultId] = useState(""),
    [comparison, setComparison] = useState<"base" | "result">("base");
  const player = useRef<HTMLAudioElement>(null),
    stopAt = useRef<number | null>(null),
    selection = useRef<{ x: number; pointer: number } | null>(null);
  const base = project.versions.find((v) => v.id === baseId),
    result = project.versions.find((v) => v.id === resultId);
  const selectedSource = source.startsWith("hum:")
    ? project.hums.find((h) => h.id === source.slice(4))
    : project.versions.find((v) => v.id === source.slice(8));
  const length = Math.max(0, end - start),
    sourceDuration = selectedSource?.durationSec || 0;
  const invalid =
    !base ||
    !selectedSource ||
    length < 0.05 ||
    start < 0 ||
    end > (base?.durationSec || 0) ||
    offset < 0 ||
    offset + length > sourceDuration + 0.0001;
  const params = useRef("");
  useEffect(() => {
    if (!base) return;
    setStart(0);
    setEnd(Math.min(1, base.durationSec));
    setResultId("");
    setComparison("base");
  }, [baseId]);
  // A saved result always keeps its original selection/parameters for A/B comparison.
  const fingerprint = JSON.stringify({
    baseId,
    source,
    start,
    end,
    offset,
    fade,
    match,
  });
  const staleResult = !!result && fingerprint !== params.current;
  function setPosition(
    event: React.PointerEvent<SVGSVGElement>,
    mode: "start" | "end",
  ) {
    if (!base || busy || project.archivedAt) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const value = Math.max(
      0,
      Math.min(
        base.durationSec,
        ((event.clientX - rect.left) / rect.width) * base.durationSec,
      ),
    );
    const anchor = selection.current?.x ?? value;
    if (mode === "start") {
      event.currentTarget.setPointerCapture(event.pointerId);
      selection.current = { x: value, pointer: event.pointerId };
      setStart(Math.floor(value * 100) / 100);
      setEnd(Math.min(base.durationSec, value + 0.05));
    } else if (selection.current?.pointer === event.pointerId) {
      setStart(Math.floor(Math.min(anchor, value) * 100) / 100);
      setEnd(
        Math.min(
          base.durationSec,
          Math.ceil(Math.max(anchor, value) * 100) / 100,
        ),
      );
    }
  }
  async function apply(event: React.FormEvent) {
    event.preventDefault();
    if (invalid || !base) return;
    setBusy(true);
    setError("");
    try {
      const output = await request<LocalVersion>(
        `projects/${project.id}/edits`,
        {
          baseVersionId: baseId,
          sourceType: source.startsWith("hum:") ? "hum" : "version",
          sourceId: source.split(":")[1],
          startSec: start,
          endSec: end,
          sourceStartSec: offset,
          crossfadeMs: fade,
          matchLevel: match,
        },
      );
      params.current = fingerprint;
      await refresh();
      setResultId(output.id);
      setComparison("result");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function playRange(context: number) {
    if (!player.current) return;
    player.current.currentTime = Math.max(0, start - context);
    stopAt.current = Math.min(base?.durationSec || end, end + context);
    try {
      await player.current.play();
    } catch {
      setError("浏览器暂未允许播放，请点击播放器播放按钮重试。");
    }
  }
  function compare(value: "base" | "result") {
    const audio = player.current;
    if (!audio || comparison === value) return;
    const current = audio.currentTime,
      playing = !audio.paused;
    audio.pause();
    setComparison(value);
    audio.onloadedmetadata = () => {
      audio.onloadedmetadata = null;
      audio.currentTime = Math.min(current, Math.max(0, audio.duration - 0.01));
      if (playing) void audio.play().catch(() => {});
    };
  }
  if (!project.versions.length)
    return (
      <div className="panel results-empty">
        <Scissors size={32} />
        <h3>先准备一首歌曲。</h3>
        <p>在文字创作中生成或导入音频后，可选取区间进行本地替换。</p>
      </div>
    );
  return (
    <div className="panel local-editor">
      <div className="panel-title">
        <span className="heading-icon">
          <Scissors size={18} />
        </span>
        <h2>本地片段替换</h2>
        <span className="pill quiet">本地处理</span>
      </div>
      <p className="local-description">
        从已有版本或哼唱中取一段等长素材，替换原曲选区。结果另存为新版本，原曲不覆盖。
      </p>
      <form onSubmit={apply}>
        <fieldset disabled={busy || !!project.archivedAt}>
          <div className="two-columns">
            <div className="field">
              <label htmlFor="edit-base">原曲版本</label>
              <select
                id="edit-base"
                value={baseId}
                onChange={(e) => setBaseId(e.target.value)}
              >
                {project.versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label} · {v.durationSec.toFixed(2)} 秒
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="edit-source">替换素材</label>
              <select
                id="edit-source"
                required
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">请选择版本或哼唱</option>
                <optgroup label="歌曲版本">
                  {project.versions.map((v) => (
                    <option key={v.id} value={`version:${v.id}`}>
                      {v.label} · {v.durationSec.toFixed(2)} 秒
                    </option>
                  ))}
                </optgroup>
                <optgroup label="哼唱素材">
                  {project.hums.map((h) => (
                    <option key={h.id} value={`hum:${h.id}`}>
                      {h.label} · {h.durationSec.toFixed(2)} 秒
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
          {base && (
            <div className="edit-timeline">
              <label>拖动波形框选区间，也可输入秒数微调</label>
              <svg
                viewBox="0 0 800 100"
                preserveAspectRatio="none"
                role="img"
                aria-label="原曲波形区间选择"
                onPointerDown={(e) => setPosition(e, "start")}
                onPointerMove={(e) => {
                  if (selection.current) setPosition(e, "end");
                }}
                onPointerUp={(e) => {
                  setPosition(e, "end");
                  selection.current = null;
                }}
                onPointerCancel={() => {
                  selection.current = null;
                }}
              >
                {(JSON.parse(base.peaks) as number[]).map((p, i) => (
                  <rect
                    key={i}
                    x={(i / 240) * 800}
                    y={50 - Math.max(1, p * 45)}
                    width="2"
                    height={Math.max(2, p * 90)}
                    fill="#a9b89c"
                  />
                ))}
                <rect
                  x={(start / base.durationSec) * 800}
                  y="0"
                  width={(length / base.durationSec) * 800}
                  height="100"
                  fill="#d5834740"
                  stroke="#c98c61"
                />
              </svg>
              <div className="range-labels">
                <span>0 秒</span>
                <span>{base.durationSec.toFixed(2)} 秒</span>
              </div>
            </div>
          )}
          <div className="edit-time-fields">
            <div className="field">
              <label htmlFor="edit-start">开始时间（秒）</label>
              <input
                id="edit-start"
                type="number"
                min="0"
                max={base?.durationSec || 0}
                step="0.01"
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="edit-end">结束时间（秒）</label>
              <input
                id="edit-end"
                type="number"
                min="0.05"
                max={base?.durationSec || 0}
                step="0.01"
                value={end}
                onChange={(e) => setEnd(Number(e.target.value))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="edit-offset">素材起点（秒）</label>
              <input
                id="edit-offset"
                type="number"
                min="0"
                max={sourceDuration}
                step="0.01"
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="edit-fade">交叉淡化（毫秒）</label>
              <input
                id="edit-fade"
                type="number"
                min="0"
                max="1000"
                step="1"
                value={fade}
                onChange={(e) => setFade(Number(e.target.value))}
                required
              />
            </div>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={match}
              onChange={(e) => setMatch(e.target.checked)}
            />
            将替换片段响度匹配到原选区（增益最多 ±12 dB，并保护素材峰值）
          </label>
          <p className="hint">
            选区 {length.toFixed(2)} 秒 · 素材可用{" "}
            {Math.max(0, sourceDuration - offset).toFixed(2)}{" "}
            秒。淡化限制在选区内，过长时缩短至选区一半。支持最长 10 分钟音频。
          </p>
        </fieldset>
        {invalid && !!source && (
          <p className="analysis-warning">
            选区越界、短于 50 毫秒或素材长度不足，请调整参数。
          </p>
        )}
        <div className="editor-submit">
          <button
            className="button primary"
            disabled={busy || invalid || !!project.archivedAt}
            type="submit"
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Scissors size={16} />
            )}
            替换并另存新版本
          </button>
          <span className="hint">不会调用 AI，不消耗模型额度</span>
        </div>
      </form>
      <section className="ab-comparison">
        <div className="local-section-title">原曲 / 结果试听</div>
        <div className="ab-buttons">
          <button
            className={`button ${comparison === "base" ? "selected-button" : "secondary"}`}
            onClick={() => compare("base")}
          >
            A · 原曲
          </button>
          <button
            className={`button ${comparison === "result" ? "selected-button" : "secondary"}`}
            disabled={!result}
            onClick={() => compare("result")}
          >
            B · 替换结果
          </button>
          <button className="text-button" onClick={() => void playRange(0)}>
            试听选区
          </button>
          <button className="text-button" onClick={() => void playRange(2)}>
            试听前后 2 秒衔接
          </button>
        </div>
        <audio
          ref={player}
          controls
          preload="metadata"
          src={`/api/audio/${comparison === "result" && result ? result.id : baseId}`}
          aria-label="原曲与结果对比播放器"
          onPlay={solo}
          onTimeUpdate={() => {
            if (
              player.current &&
              stopAt.current !== null &&
              player.current.currentTime >= stopAt.current
            ) {
              player.current.pause();
              stopAt.current = null;
            }
          }}
          onEnded={() => {
            stopAt.current = null;
          }}
        />
        {result && (
          <div className="edit-result" role="status">
            <Check size={16} />
            <span>
              已保存新版本：{result.label}。选区外解码采样保持一致，输出 44.1
              kHz 立体声浮点 WAV。
            </span>
            <a
              className="text-button"
              href={`/api/audio/${result.id}?download=1`}
            >
              <Download size={14} />
              下载结果
            </a>
          </div>
        )}
        {staleResult && (
          <p className="analysis-warning">
            参数已修改；B 仍是上次保存的结果。重新替换后才会更新。
          </p>
        )}
        <p className="hint">
          A/B
          切换保留播放位置；调整选区后，“试听选区”使用当前选区。未做节拍吸附、调性校正或
          AI 重写；原曲已有的过载信号不在此处修复。
        </p>
      </section>
    </div>
  );
}
export default function LocalStudio({
  project,
  mode,
  refresh,
  initialBaseId,
  onLockChange,
}: {
  project: LocalProject;
  mode: "hums" | "edit";
  refresh: () => Promise<unknown>;
  initialBaseId?: string;
  onLockChange: (b: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        const state = await request<{ online: boolean }>("audio-service");
        if (mounted) setOnline(state.online);
      } catch {
        if (mounted) setOnline(false);
      }
    };
    void check();
    const timer = setInterval(check, 10000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (mode !== "edit") return;
    onLockChange(busy);
    return () => onLockChange(false);
  }, [mode, busy, onLockChange]);
  return (
    <div className="local-studio">
      {online === false && (
        <div className="banner warning" role="status">
          本地音频服务未连接。已有素材仍可试听，录音可下载；保存分析与片段替换需要启动音频服务。
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          {error}
        </div>
      )}
      {mode === "hums" ? (
        <HumWorkspace
          project={project}
          busy={busy}
          setBusy={setBusy}
          refresh={refresh}
          setError={setError}
          onLockChange={onLockChange}
        />
      ) : (
        <LocalEditor
          project={project}
          initialBaseId={initialBaseId}
          busy={busy}
          setBusy={setBusy}
          refresh={refresh}
          setError={setError}
        />
      )}
    </div>
  );
}
