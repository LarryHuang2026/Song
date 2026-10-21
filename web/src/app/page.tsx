"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AudioLines,
  Plus,
  ArrowUpRight,
  FolderOpen,
  Archive,
  Music2,
  Sparkles,
  ChevronDown,
  Check,
  Upload,
  Download,
  Clock3,
  CircleHelp,
  LoaderCircle,
  X,
  Search,
  RotateCcw,
  SlidersHorizontal,
  AlertCircle,
  Headphones,
  Save,
  Pencil,
  Radio,
  Copy,
  Square,
} from "lucide-react";
import {
  models,
  activeStates,
  buildPrompt,
  type GenerationRequest,
} from "@/lib/domain";
import { vocalConflicts, clearVocalConflicts } from "@/lib/vocal";
import {
  creationPresets,
  vocalProfiles,
  vocalGroups,
  quickVocalLabels,
  vocalProfile,
} from "@/lib/creative-presets";
import LocalStudio, { type Hum } from "./local-studio";
import AiStudio from "./ai-studio";
type Workspace = "create" | "hums" | "edit" | "ai_cover" | "ai_replace";

type Output = {
  id: string;
  index: number;
  status: string;
  receivedBytes: number;
  totalBytes: number | null;
  errorMessage: string | null;
};
type Job = {
  id: string;
  projectId: string;
  status: string;
  provider: string;
  model: string;
  requestParams: string;
  createdAt: string;
  errorMessage: string | null;
  outputs: Output[];
};
type Version = {
  id: string;
  label: string;
  sourceType: string;
  implementation: string;
  provider: string;
  model: string;
  paramsSnapshot: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  peaks: string;
  createdAt: string;
  parentVersionId: string | null;
};
type Project = {
  id: string;
  name: string;
  lyricsDraft: string;
  promptDraft: string;
  aiCoverDraft: string;
  aiRewriteDraft: string;
  selectedVersionId: string | null;
  archivedAt: string | null;
  versions: Version[];
  jobs: Job[];
  hums: Hum[];
  updatedAt: string;
};
type State = {
  projects: Project[];
  configured: boolean;
  workerOnline: boolean;
};
const defaults: GenerationRequest = {
  provider: "mock",
  model: "suno",
  lyrics: "",
  description: "",
  style: "",
  mood: "",
  vocal: "",
  instruments: "",
  duration: 180,
  instrumental: false,
};
const descriptionPresets = [
  {
    label: "温暖的中文流行",
    text: "写一首关于傍晚回家路上的中文流行歌。温暖的钢琴，轻轻的木吉他，像有人在等你回家。",
  },
  {
    label: "深夜的独立民谣",
    text: "写一首深夜独处时听的独立民谣。简洁的木吉他，轻柔的人声，带一点思念和释然。",
  },
  {
    label: "轻快的夏日节奏",
    text: "写一首适合夏日出游的轻快歌曲。明亮的吉他，活泼的鼓点，充满阳光、自由和期待。",
  },
];

function PresetChoices({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const selected = value
    .split(/[、,，;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const visible = choices.filter(
    (choice, index) => expanded || index < 6 || selected.includes(choice),
  );
  const hiddenCount = choices.length - visible.length;
  return (
    <div
      id={id}
      className="inspiration-chips preset-choices"
      role="group"
      aria-label={`${label}常用选项`}
    >
      {visible.map((choice) => {
        const active = selected.includes(choice);
        const next = active
          ? selected.filter((item) => item !== choice)
          : [...selected, choice];
        return (
          <button
            type="button"
            key={choice}
            aria-pressed={active}
            disabled={next.join("、").length > 200}
            onClick={() => onChange(next.join("、"))}
          >
            {active ? <Check size={11} /> : <Plus size={11} />}
            {choice}
          </button>
        );
      })}
      {(expanded || hiddenCount > 0) && (
        <button
          type="button"
          className="preset-toggle"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? `收起${label}` : `更多${label}（${hiddenCount}）`}
          <ChevronDown size={11} />
        </button>
      )}
    </div>
  );
}

const statusLabels: Record<string, string> = {
  uploading: "上传源音频",
  running: "AI 正在创作",
  poll_failed: "查询已暂停",
  queued: "排队中",
  submitting: "正在创作",
  downloading: "正在保存音频",
  succeeded: "已完成",
  failed: "生成失败",
  download_failed: "下载未完成",
  unknown_submission: "提交结果未知",
  cancelled: "已取消",
};
const durationLabel = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
async function api<T = unknown>(
  url: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${url}`, {
    method,
    ...(data instanceof FormData
      ? { body: data }
      : data
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          }
        : {}),
    cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "请求失败，请稍后重试");
  return body;
}
function Waveform({
  values,
  selected,
}: {
  values: number[];
  selected: boolean;
}) {
  return (
    <svg
      className={`waveform ${selected ? "selected" : ""}`}
      viewBox="0 0 720 64"
      preserveAspectRatio="none"
      aria-label="真实音频波形"
      role="img"
    >
      {values.map((v, i) => (
        <rect
          key={i}
          x={i * 3}
          y={32 - Math.max(1, v * 29)}
          width="1.8"
          height={Math.max(2, v * 58)}
          rx="0.8"
        />
      ))}
    </svg>
  );
}
export default function Studio() {
  const [state, setState] = useState<State>({
    projects: [],
    configured: false,
    workerOnline: false,
  });
  const [loaded, setLoaded] = useState(false),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<GenerationRequest>(defaults),
    [dirty, setDirty] = useState(false);
  const [customVocal, setCustomVocal] = useState(false);
  const [archived, setArchived] = useState(false),
    [query, setQuery] = useState("");
  const [newDialog, setNewDialog] = useState(false),
    [newName, setNewName] = useState("");
  const [renameDialog, setRenameDialog] = useState(false),
    [renameName, setRenameName] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [workspace, setWorkspace] = useState<Workspace>("create");
  const [localLock, setLocalLock] = useState(false);
  const [editBaseId, setEditBaseId] = useState<string>();
  const [tab, setTab] = useState<"versions" | "jobs">("versions"),
    [details, setDetails] = useState<string | null>(null);
  const aiDraftSave = useRef<(() => Promise<void>) | null>(null);
  const registerAiDraftSave = useCallback(
    (save: (() => Promise<void>) | null) => {
      aiDraftSave.current = save;
    },
    [],
  );
  const fileInput = useRef<HTMLInputElement>(null),
    projectIdRef = useRef<string | null>(null);
  const pendingSubmission = useRef<{ fingerprint: string; id: string } | null>(
    null,
  );
  const refreshSequence = useRef(0);
  const archiveMode = useRef(archived);
  archiveMode.current = archived;
  const project = state.projects.find((p) => p.id === selectedId);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const value = await api<State>(`state${archived ? "?archived=true" : ""}`);
    if (
      sequence === refreshSequence.current &&
      archiveMode.current === archived
    ) {
      setState(value);
      setLoaded(true);
    }
    return value;
  }, [archived]);
  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        await refresh();
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void tick();
    const timer = setInterval(() => {
      if (!document.hidden) void tick();
    }, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    if (!loaded) return;
    const p =
      state.projects.find((p) => p.id === selectedId) || state.projects[0];
    if (p?.id !== projectIdRef.current) {
      projectIdRef.current = p?.id || null;
      setSelectedId(p?.id || null);
      if (p) {
        let draft = {};
        try {
          draft = JSON.parse(p.promptDraft);
        } catch {}
        setForm({ ...defaults, ...draft, lyrics: p.lyricsDraft });
      } else setForm(defaults);
      setDirty(false);
      setCustomVocal(false);
      setDetails(null);
      pendingSubmission.current = null;
    }
  }, [state.projects, selectedId, loaded]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!newDialog && !renameDialog) return;
    const previous = document.activeElement as HTMLElement | null;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"] button:not(:disabled), [role="dialog"] input:not(:disabled)',
        ),
      );
      const first = items[0],
        last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      previous?.focus();
    };
  }, [newDialog, renameDialog]);
  function update<K extends keyof GenerationRequest>(
    key: K,
    value: GenerationRequest[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }
  async function action(work: () => Promise<void>) {
    if (localLock) {
      setError(
        "请先停止录音，并保存、下载或丢弃当前录音预览；处理中请等待完成。",
      );
      return;
    }
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await aiDraftSave.current?.();
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    if (!project || !dirty) return;
    const {
      lyrics,
      sourceJobId: _source,
      parentVersionId: _parent,
      ...promptDraft
    } = form;
    await api(`projects/${project.id}`, "PATCH", {
      lyricsDraft: lyrics,
      promptDraft,
    });
    setDirty(false);
  }
  async function switchProject(id: string) {
    await action(async () => {
      await saveDraft();
      setSelectedId(id);
    });
  }
  async function launch(mode: Workspace) {
    await action(async () => {
      await saveDraft();
      if (!project) {
        const p = await api<Project>("projects", "POST", { name: "我的音乐" });
        refreshSequence.current++;
        archiveMode.current = false;
        setArchived(false);
        setState((previous) => ({
          ...previous,
          projects: [{ ...p, versions: [], jobs: [], hums: [] }],
        }));
        setSelectedId(p.id);
      }
      setWorkspace(mode);
    });
  }
  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    await action(async () => {
      await saveDraft();
      const p = await api<Project>("projects", "POST", { name: newName });
      setNewDialog(false);
      setNewName("");
      if (archived) {
        refreshSequence.current++;
        archiveMode.current = false;
        setArchived(false);
        setState((prev) => ({
          ...prev,
          projects: [{ ...p, versions: [], jobs: [], hums: [] }],
        }));
      } else await refresh();
      setSelectedId(p.id);
    });
  }
  async function generate(e: React.FormEvent) {
    e.preventDefault();
    if (!project) return;
    await action(async () => {
      await saveDraft();
      const fingerprint = project.id + JSON.stringify(form);
      if (pendingSubmission.current?.fingerprint !== fingerprint)
        pendingSubmission.current = { fingerprint, id: crypto.randomUUID() };
      await api(`projects/${project.id}/jobs`, "POST", {
        ...form,
        clientRequestId: pendingSubmission.current.id,
      });
      pendingSubmission.current = null;
      setTab("jobs");
      setNotice(
        form.provider === "mock"
          ? "演示任务已加入队列，不消耗额度"
          : "生成任务已加入队列",
      );
      await refresh();
    });
  }
  function reuse(params: string, jobId?: string, parentVersionId?: string) {
    const next = JSON.parse(params) as GenerationRequest;
    setForm({ ...defaults, ...next, sourceJobId: jobId, parentVersionId });
    setCustomVocal(false);
    setDirty(true);
    setNotice("已载入创作参数，修改后可再次提交");
    document.getElementById("creative-description")?.focus();
  }
  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !project) return;
    await action(async () => {
      const data = new FormData();
      data.set("file", file);
      await api(`projects/${project.id}/import`, "POST", data);
      setTab("versions");
      await refresh();
      setNotice("原始音频已保存为新版本");
    });
    event.target.value = "";
  }
  const chosenVocal = vocalProfile(form.vocal);
  const isCustomVocal = customVocal || (!!form.vocal && !chosenVocal);
  const voiceConflicts = vocalConflicts(form);
  const promptText = buildPrompt(form);
  const promptTooLong = promptText.length > 10000;
  const activeJobs =
    project?.jobs.filter((j) => activeStates.includes(j.status)).length || 0;
  const canGenerate =
    !busy &&
    !!project &&
    !archived &&
    !!form.description.trim() &&
    !voiceConflicts.length &&
    (form.instrumental || !isCustomVocal || !!form.vocal.trim()) &&
    !promptTooLong &&
    (form.provider === "mock" || state.configured);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Song 首页">
          <span className="brand-icon">
            <AudioLines size={22} />
          </span>
          <span>
            song<span className="brand-dot">.</span>
          </span>
          <span className="local-badge">LOCAL</span>
        </a>
        <div className="workspace-label">你的创作空间</div>
        <button
          className={`nav-item ${!archived ? "active" : ""}`}
          onClick={() =>
            void action(async () => {
              await saveDraft();
              setArchived(false);
              setSelectedId(null);
            })
          }
        >
          <FolderOpen size={18} />
          歌曲项目
          <span className="nav-count">
            {!archived ? state.projects.length : ""}
          </span>
        </button>
        <button
          className={`nav-item ${archived ? "active" : ""}`}
          onClick={() =>
            void action(async () => {
              await saveDraft();
              setArchived(true);
              setSelectedId(null);
            })
          }
        >
          <Archive size={18} />
          已归档
        </button>
        <div className="sidebar-divider" />
        <div className="project-heading">
          <span>{archived ? "已归档项目" : "最近的项目"}</span>
          <button
            className="icon-button"
            title="新建项目"
            aria-label="新建项目"
            onClick={() => setNewDialog(true)}
          >
            <Plus size={17} />
          </button>
        </div>
        <div className="search-box">
          <Search size={14} />
          <input
            aria-label="搜索项目"
            placeholder="搜索你的歌曲"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="project-list">
          {state.projects
            .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
            .map((p, i) => (
              <button
                key={p.id}
                className={`project-item ${p.id === selectedId ? "selected" : ""}`}
                onClick={() => void switchProject(p.id)}
              >
                <span className={`mini-cover tone-${i % 4}`}>
                  <Music2 size={17} />
                </span>
                <span className="project-item-text">
                  <strong>{p.name}</strong>
                  <small>
                    {p.versions.length} 个版本 ·{" "}
                    {dateLabel(p.updatedAt).split(" ")[0]}
                  </small>
                </span>
                {p.id === selectedId && <span className="selected-dot" />}
              </button>
            ))}
          {loaded && !state.projects.length && (
            <p className="sidebar-empty">
              {archived ? "还没有归档项目" : "每首好歌，都从一个灵感开始。"}
            </p>
          )}
        </div>
        {!archived && (
          <button className="new-project" onClick={() => setNewDialog(true)}>
            <Plus size={16} />
            新建歌曲项目
          </button>
        )}
        <div className="sidebar-footer">
          <span
            className={`connection-dot ${state.workerOnline ? "online" : ""}`}
          />
          <span>
            {state.workerOnline ? "创作服务已连接" : "创作服务未启动"}
          </span>
          <span className="version-label">v0.1</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="breadcrumbs">
            工作台 <span>/</span> <strong>{project?.name || "歌曲项目"}</strong>
          </div>
          <div className="topbar-right">
            <span className="privacy-label">
              <span className="small-dot" />
              作品保存在本机
            </span>
            <button
              className="icon-button"
              title="使用说明"
              aria-label="使用说明"
              onClick={() => {
                setDetails(details === "help" ? null : "help");
              }}
            >
              <CircleHelp size={19} />
            </button>
            <span className="avatar">我</span>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">MAKE ROOM FOR YOUR NEXT SONG</div>
              <h1>
                {project?.name || "让灵感，有自己的声音。"}
                {project && (
                  <button
                    className="icon-button rename"
                    title="重命名项目"
                    aria-label="重命名项目"
                    onClick={() => {
                      setRenameName(project.name);
                      setRenameDialog(true);
                    }}
                  >
                    <Pencil size={17} />
                  </button>
                )}
              </h1>
              <p>
                {project
                  ? "写下想法，选择声音。把此刻的灵感，留在下一首歌里。"
                  : "从一句描述开始，在这里创作、聆听，找到属于你的那一版。"}
              </p>
            </div>
            {project && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await saveDraft();
                    await api(`projects/${project.id}`, "PATCH", {
                      archived: !archived,
                    });
                    if (archived) {
                      refreshSequence.current++;
                      archiveMode.current = false;
                      setArchived(false);
                      setState((prev) => ({
                        ...prev,
                        projects: [{ ...project, archivedAt: null }],
                      }));
                      setSelectedId(project.id);
                    } else {
                      await refresh();
                      setSelectedId(null);
                    }
                  })
                }
              >
                <Archive size={15} />
                {archived ? "恢复项目" : "归档项目"}
              </button>
            )}
          </div>
          {error && (
            <div className="banner error" role="alert">
              <AlertCircle size={17} />
              <span>{error}</span>
              <button
                aria-label="关闭错误提示"
                className="icon-button"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Check size={16} />
              {notice}
            </div>
          )}
          {details === "help" && (
            <div className="help-panel">
              <strong>你的本地音乐工作台</strong>
              <p>
                先新建歌曲项目，填写描述并保存草稿。演示模式会生成两段 8
                秒合成旋律，用于体验试听和版本管理；真实模式调用
                FluxPort，生成结果自动下载到本机。
              </p>
              <p>
                真实调用按项目验证记录约 ¥0.20 /
                次，时长、歌词与纯音乐要求都不能保证精确执行。哼唱成曲与 AI
                段落重写已开放实验入口，需要配置独立音频服务。生成中断后请核对平台记录；下载失败可单独恢复保存。
              </p>
            </div>
          )}
          {!state.workerOnline && project && (
            <div className="banner warning">
              <Radio size={17} />
              <span>
                创作服务尚未连接。可继续编辑草稿和试听，生成任务将在服务启动后处理。
                <code>npm run worker</code>
              </span>
            </div>
          )}
          {!loaded ? (
            <div className="empty-state">
              <LoaderCircle className="spin" />
              <p>正在打开创作空间…</p>
            </div>
          ) : !project ? (
            <div className="welcome-card">
              <div className="welcome-art">
                <AudioLines size={64} strokeWidth={1.3} />
                <span className="orbit orbit-a" />
                <span className="orbit orbit-b" />
              </div>
              <span className="pill">一个想法，无限可能</span>
              <h2>下一首歌，从这里开始。</h2>
              <p>
                把文字变成旋律，把每次尝试留作版本。
                <br />
                你的灵感、草稿和作品，都有自己的位置。
              </p>
              <button
                className="button primary"
                onClick={() => setNewDialog(true)}
              >
                <Plus size={17} />
                创建第一首歌
                <ArrowUpRight size={17} />
              </button>
              <div className="quick-launch">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void launch("hums")}
                >
                  直接录音 / 上传
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void launch("ai_cover")}
                >
                  打开 AI 哼唱成曲
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void launch("ai_replace")}
                >
                  打开 AI 段落重写
                </button>
              </div>
              <p className="hint">
                首次打开会自动建立一个歌曲项目，保存你的素材与版本。
              </p>
              <div className="welcome-features">
                <span>
                  <Sparkles size={16} />
                  AI 文字成歌
                </span>
                <span>
                  <Headphones size={16} />
                  多版本试听
                </span>
                <span>
                  <FolderOpen size={16} />
                  本地保存
                </span>
              </div>
            </div>
          ) : (
            <>
              <div
                className="workspace-tabs"
                role="tablist"
                aria-label="创作功能"
              >
                {(
                  [
                    ["create", "文字创作"],
                    ["hums", "哼唱素材"],
                    ["edit", "本地编辑"],
                    ["ai_cover", "AI 哼唱成曲"],
                    ["ai_replace", "AI 段落重写"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    role="tab"
                    aria-selected={workspace === key}
                    className={workspace === key ? "selected" : ""}
                    key={key}
                    onClick={() =>
                      void action(async () => {
                        await saveDraft();
                        setError("");
                        setWorkspace(key);
                      })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {workspace === "ai_cover" || workspace === "ai_replace" ? (
                <AiStudio
                  key={project.id + workspace}
                  project={project}
                  kind={
                    workspace === "ai_cover" ? "hum_cover" : "section_rewrite"
                  }
                  refresh={refresh}
                  navigate={(mode) => void launch(mode)}
                  onLockChange={setLocalLock}
                  onBeforeLeaveChange={registerAiDraftSave}
                />
              ) : workspace !== "create" ? (
                <LocalStudio
                  key={project.id + workspace}
                  project={project}
                  mode={workspace}
                  refresh={refresh}
                  initialBaseId={editBaseId}
                  onLockChange={setLocalLock}
                />
              ) : (
                <div className="studio-grid">
                  <section className="creation-panel panel">
                    <div className="panel-heading">
                      <div className="panel-title">
                        <span className="heading-icon">
                          <SlidersHorizontal size={18} />
                        </span>
                        <h2>创作设定</h2>
                      </div>
                      <span className="pill quiet">文字成歌</span>
                    </div>
                    <form onSubmit={generate}>
                      <fieldset disabled={busy || archived}>
                        <div className="field">
                          <div className="label-row">
                            <label htmlFor="creative-description">
                              创作描述 <span className="required">*</span>
                            </label>
                            <span>给音乐一个方向</span>
                          </div>
                          <textarea
                            id="creative-description"
                            className="description-input"
                            required
                            maxLength={2000}
                            placeholder="比如：写一首关于傍晚回家路上的歌。温暖的钢琴，轻轻的吉他，像有人在等你回家。"
                            value={form.description}
                            onChange={(e) =>
                              update("description", e.target.value)
                            }
                          />
                          <div className="inspiration-chips">
                            {descriptionPresets.map(({ label, text }) => (
                              <button
                                type="button"
                                key={label}
                                onClick={() => update("description", text)}
                              >
                                <Plus size={11} />
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="two-columns">
                          <div className="field">
                            <label htmlFor="style">音乐风格</label>
                            <input
                              id="style"
                              maxLength={200}
                              placeholder="流行、民谣、爵士…"
                              value={form.style}
                              onChange={(e) => update("style", e.target.value)}
                            />
                            <PresetChoices
                              label="音乐风格"
                              choices={creationPresets.style}
                              value={form.style}
                              onChange={(value) => update("style", value)}
                            />
                          </div>
                          <div className="field">
                            <label htmlFor="mood">情绪氛围</label>
                            <input
                              id="mood"
                              maxLength={200}
                              placeholder="温暖、松弛、充满希望…"
                              value={form.mood}
                              onChange={(e) => update("mood", e.target.value)}
                            />
                            <PresetChoices
                              label="情绪氛围"
                              choices={creationPresets.mood}
                              value={form.mood}
                              onChange={(value) => update("mood", value)}
                            />
                          </div>
                        </div>
                        <div className="two-columns">
                          <div className="field">
                            <label htmlFor="vocal">演唱声音</label>
                            <div className="select-wrap">
                              <select
                                id="vocal"
                                value={
                                  isCustomVocal ? "__custom__" : form.vocal
                                }
                                disabled={form.instrumental}
                                onChange={(e) => {
                                  const custom =
                                    e.target.value === "__custom__";
                                  setCustomVocal(custom);
                                  update("vocal", custom ? "" : e.target.value);
                                }}
                              >
                                <option value="">让 AI 选择</option>
                                {vocalGroups.map((group) => (
                                  <optgroup key={group} label={group}>
                                    {vocalProfiles
                                      .filter(
                                        (profile) => profile.group === group,
                                      )
                                      .map((profile) => (
                                        <option
                                          key={profile.label}
                                          value={profile.label}
                                        >
                                          {profile.label}
                                        </option>
                                      ))}
                                  </optgroup>
                                ))}
                                <option value="__custom__">自定义声线…</option>
                              </select>
                              <ChevronDown size={14} />
                            </div>
                            {isCustomVocal ? (
                              <div className="custom-vocal">
                                <label htmlFor="custom-vocal">
                                  自定义声线描述
                                </label>
                                <input
                                  id="custom-vocal"
                                  maxLength={100}
                                  disabled={form.instrumental}
                                  value={form.vocal}
                                  onChange={(e) =>
                                    update("vocal", e.target.value)
                                  }
                                  placeholder="如：年轻成人的清甜女声，轻声、少颤音，不要厚重唱腔"
                                />
                                <p className="hint">
                                  描述音色、气息和唱法，最多 100 字。
                                  {!form.vocal.trim() && !form.instrumental
                                    ? "请填写后再生成。"
                                    : ""}
                                </p>
                              </div>
                            ) : (
                              <p className="vocal-profile-note">
                                {chosenVocal?.description ||
                                  "可选年轻、轻柔、空灵等声线，也可自定义。"}
                              </p>
                            )}
                            <div
                              className="inspiration-chips preset-choices vocal-quick"
                              role="group"
                              aria-label="声线快捷选择"
                            >
                              {quickVocalLabels.map((label) => (
                                <button
                                  type="button"
                                  key={label}
                                  aria-pressed={
                                    form.vocal === label && !isCustomVocal
                                  }
                                  disabled={form.instrumental}
                                  onClick={() => {
                                    setCustomVocal(false);
                                    update("vocal", label);
                                  }}
                                >
                                  {form.vocal === label && !isCustomVocal ? (
                                    <Check size={11} />
                                  ) : (
                                    <Plus size={11} />
                                  )}
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="field">
                            <label htmlFor="instruments">乐器偏好</label>
                            <input
                              id="instruments"
                              maxLength={200}
                              placeholder="钢琴、木吉他、弦乐…"
                              value={form.instruments}
                              onChange={(e) =>
                                update("instruments", e.target.value)
                              }
                            />
                            <PresetChoices
                              label="乐器偏好"
                              choices={creationPresets.instruments}
                              value={form.instruments}
                              onChange={(value) => update("instruments", value)}
                            />
                          </div>
                        </div>
                        <p className="hint">
                          演唱声音通过文字提示传达给模型，实际声线仍可能偏离设定。
                        </p>
                        {voiceConflicts.length > 0 && (
                          <div className="vocal-conflict" role="alert">
                            <strong>演唱要求有冲突</strong>
                            <p>
                              {voiceConflicts
                                .map(
                                  (c) =>
                                    `${c.label}含「${c.terms.join("、")}」`,
                                )
                                .join("；")}
                              ，与{form.instrumental ? "纯音乐" : form.vocal}
                              不一致。请先修改，避免把冲突要求一起发送。
                            </p>
                            <button
                              type="button"
                              className="button small secondary"
                              onClick={() => {
                                setForm((previous) =>
                                  clearVocalConflicts(previous),
                                );
                                setDirty(true);
                              }}
                            >
                              清除冲突声线描述
                            </button>
                          </div>
                        )}
                        <div className="section-divider" />
                        <div className="field lyrics-field">
                          <div className="label-row">
                            <label htmlFor="lyrics">歌词</label>
                            <label className="check-label">
                              <input
                                type="checkbox"
                                checked={form.instrumental}
                                onChange={(e) =>
                                  update("instrumental", e.target.checked)
                                }
                              />
                              纯音乐
                            </label>
                          </div>
                          <textarea
                            id="lyrics"
                            maxLength={8000}
                            disabled={form.instrumental}
                            placeholder={
                              form.instrumental
                                ? "纯音乐模式：不使用歌词"
                                : "写下你的歌词，也可以留空，让 AI 自由创作。\n\n[主歌]\n傍晚的风吹过旧街口…\n\n[副歌]\n回家的路不远也不近…"
                            }
                            value={form.lyrics}
                            onChange={(e) => update("lyrics", e.target.value)}
                          />
                          <div className="field-caption">
                            <span>
                              {form.instrumental
                                ? "纯音乐要求通过提示词表达，不保证无人声"
                                : "支持 [主歌]、[副歌] 等段落标记"}
                            </span>
                            <span>{form.lyrics.length}/8000</span>
                          </div>
                        </div>
                        <div className="section-divider" />
                        <div className="field">
                          <div className="label-row">
                            <label htmlFor="duration">目标时长</label>
                            <strong className="orange-text">
                              {durationLabel(form.duration)}
                            </strong>
                          </div>
                          <input
                            id="duration"
                            type="range"
                            min="15"
                            max="300"
                            step="15"
                            value={form.duration}
                            onChange={(e) =>
                              update("duration", Number(e.target.value))
                            }
                          />
                          <div className="range-labels">
                            <span>15 秒</span>
                            <span>5 分钟</span>
                          </div>
                          <p className="hint">
                            目标时长仅作创作参考，以生成结果为准。
                            {form.model === "Lyria-3pro音频音乐" &&
                              form.duration > 180 &&
                              "当前模型标称上限约 3 分钟。"}
                          </p>
                        </div>
                        <div className="two-columns">
                          <div className="field">
                            <label htmlFor="provider">创作模式</label>
                            <div className="select-wrap">
                              <select
                                id="provider"
                                value={form.provider}
                                onChange={(e) =>
                                  update(
                                    "provider",
                                    e.target
                                      .value as GenerationRequest["provider"],
                                  )
                                }
                              >
                                <option value="mock">演示 · 不消耗额度</option>
                                <option
                                  value="fluxport"
                                  disabled={!state.configured}
                                >
                                  FluxPort · 真实生成
                                </option>
                              </select>
                              <ChevronDown size={14} />
                            </div>
                          </div>
                          <div className="field">
                            <label htmlFor="model">音乐模型</label>
                            <div className="select-wrap">
                              <select
                                id="model"
                                value={form.model}
                                onChange={(e) =>
                                  update(
                                    "model",
                                    e.target
                                      .value as GenerationRequest["model"],
                                  )
                                }
                              >
                                {models.map((m) => (
                                  <option key={m} value={m}>
                                    {m === "suno"
                                      ? "Suno · 推荐"
                                      : m.replace("音频音乐", "")}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown size={14} />
                            </div>
                          </div>
                        </div>
                      </fieldset>
                      {promptTooLong && (
                        <p className="job-error" role="alert">
                          合并后的提示词共 {promptText.length} 字符，超过 10000
                          字符限制，请缩短描述或歌词。
                        </p>
                      )}
                      <details className="prompt-preview">
                        <summary>查看实际发送的提示词</summary>
                        <pre>{promptText}</pre>
                      </details>
                      <div className="submit-area">
                        <div className="generation-note">
                          <span>
                            {form.provider === "mock"
                              ? "演示模式 · 两段 8 秒合成旋律"
                              : "预计 ¥0.20 / 次 · 不保证歌词逐字演唱"}
                          </span>
                          <button
                            className="save-button"
                            type="button"
                            disabled={busy || !dirty || archived}
                            onClick={() =>
                              void action(async () => {
                                await saveDraft();
                                setNotice("创作草稿已保存");
                              })
                            }
                          >
                            <Save size={13} />
                            {dirty ? "保存草稿" : "草稿已保存"}
                          </button>
                        </div>
                        <button
                          className="button primary generate-button"
                          type="submit"
                          disabled={!canGenerate}
                        >
                          {busy ? (
                            <LoaderCircle size={18} className="spin" />
                          ) : (
                            <Sparkles size={18} />
                          )}
                          {form.provider === "mock"
                            ? "体验一次创作"
                            : "生成歌曲"}
                          <ArrowUpRight size={18} />
                        </button>
                        {!state.configured && (
                          <p className="hint centered">
                            真实生成需在项目根目录 .env.local 配置 API Key
                          </p>
                        )}
                      </div>
                    </form>
                  </section>
                  <section className="results-panel">
                    <div className="results-heading">
                      <div className="result-tabs">
                        <button
                          className={tab === "versions" ? "current" : ""}
                          onClick={() => setTab("versions")}
                        >
                          作品版本<span>{project.versions.length}</span>
                        </button>
                        <button
                          className={tab === "jobs" ? "current" : ""}
                          onClick={() => setTab("jobs")}
                        >
                          生成记录
                          {activeJobs > 0 && (
                            <span className="orange-count">{activeJobs}</span>
                          )}
                        </button>
                      </div>
                      <button
                        className="button small secondary"
                        disabled={busy || archived}
                        onClick={() => fileInput.current?.click()}
                      >
                        <Upload size={14} />
                        导入音频
                      </button>
                      <input
                        ref={fileInput}
                        className="hidden-input"
                        type="file"
                        accept=".mp3,.wav,.m4a,.flac"
                        aria-label="导入音频文件"
                        onChange={(e) => void importFile(e)}
                      />
                    </div>
                    {tab === "versions" ? (
                      !project.versions.length ? (
                        <div className="results-empty panel">
                          <span className="empty-icon">
                            <Headphones size={33} strokeWidth={1.4} />
                          </span>
                          <h3>给灵感一点时间。</h3>
                          <p>
                            生成的歌曲会出现在这里。
                            <br />
                            试听、比较，然后留下你最喜欢的一版。
                          </p>
                          <div className="empty-dashes">
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                            <span />
                          </div>
                          <button
                            className="text-button"
                            disabled={archived || busy}
                            onClick={() => fileInput.current?.click()}
                          >
                            也可以导入已有歌曲 <ArrowUpRight size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="version-list">
                          {project.versions.map((v, index) => {
                            const selected = project.selectedVersionId === v.id;
                            const isDemo = v.implementation === "demo";
                            return (
                              <article
                                className={`version-card panel ${selected ? "chosen" : ""}`}
                                key={v.id}
                              >
                                <div className="version-top">
                                  <span
                                    className={`cover-art tone-${index % 4}`}
                                  >
                                    <AudioLines size={25} strokeWidth={1.5} />
                                  </span>
                                  <div className="version-info">
                                    <div className="version-title">
                                      <h3>{v.label}</h3>
                                      {selected && (
                                        <span className="chosen-label">
                                          <Check size={11} />
                                          选定版本
                                        </span>
                                      )}
                                    </div>
                                    <p>
                                      {v.sourceType === "hum_generate"
                                        ? "AI 音频参考候选"
                                        : v.sourceType === "section_edit"
                                          ? "AI 段落重写 + 本地重建"
                                          : v.sourceType === "local_edit"
                                            ? "本地片段替换"
                                            : v.sourceType === "import"
                                              ? "导入音频"
                                              : isDemo
                                                ? "演示旋律"
                                                : v.model}{" "}
                                      <span>·</span> {dateLabel(v.createdAt)}
                                    </p>
                                  </div>
                                  <span
                                    className={`pill ${isDemo ? "demo-pill" : "quiet"}`}
                                  >
                                    {isDemo
                                      ? "演示"
                                      : v.implementation === "local"
                                        ? "本地处理"
                                        : v.implementation ===
                                            "audio_reference_unverified"
                                          ? "音频参考 · 未评估"
                                          : v.implementation ===
                                              "experimental_ai_local"
                                            ? "AI + 本地 · 实验性"
                                            : "API 原生"}
                                  </span>
                                </div>
                                <Waveform
                                  values={JSON.parse(v.peaks)}
                                  selected={selected}
                                />
                                <audio
                                  controls
                                  preload="none"
                                  src={`/api/audio/${v.id}`}
                                  aria-label={`试听 ${v.label}`}
                                  onPlay={(event) => {
                                    const current = event.currentTarget;
                                    document
                                      .querySelectorAll("audio")
                                      .forEach((a) => {
                                        if (a !== current) a.pause();
                                      });
                                  }}
                                />
                                <div className="audio-meta">
                                  <span>
                                    {durationLabel(v.durationSec)} ·{" "}
                                    {v.sampleRate / 1000} kHz ·{" "}
                                    {v.channels === 2 ? "立体声" : "单声道"}
                                  </span>
                                  {isDemo && <span>合成测试音频，无人声</span>}
                                </div>
                                <div className="version-actions">
                                  <button
                                    className={`button small ${selected ? "selected-button" : "secondary"}`}
                                    disabled={busy || selected || archived}
                                    onClick={() =>
                                      void action(async () => {
                                        await api(
                                          `projects/${project.id}`,
                                          "PATCH",
                                          { selectedVersionId: v.id },
                                        );
                                        await refresh();
                                      })
                                    }
                                  >
                                    <Check size={13} />
                                    {selected ? "已选定" : "选用此版本"}
                                  </button>
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      setDetails(details === v.id ? null : v.id)
                                    }
                                  >
                                    <SlidersHorizontal size={13} />
                                    创作参数
                                  </button>
                                  {v.sourceType === "text_generate" && (
                                    <button
                                      className="text-button"
                                      disabled={archived || busy}
                                      onClick={() =>
                                        reuse(v.paramsSnapshot, undefined, v.id)
                                      }
                                    >
                                      <Copy size={13} />
                                      沿用参数
                                    </button>
                                  )}
                                  <button
                                    className="text-button"
                                    disabled={archived || busy}
                                    onClick={() =>
                                      void action(async () => {
                                        await saveDraft();
                                        setEditBaseId(v.id);
                                        setWorkspace("edit");
                                      })
                                    }
                                  >
                                    本地编辑
                                  </button>
                                  <a
                                    className="icon-button download-link"
                                    aria-label={`下载 ${v.label}`}
                                    title="下载原始音频"
                                    href={`/api/audio/${v.id}?download=1`}
                                  >
                                    <Download size={16} />
                                  </a>
                                </div>
                                {details === v.id && (
                                  <div className="version-details">
                                    <p>
                                      来源：{v.provider} / {v.model}{" "}
                                      {v.parentVersionId &&
                                        `· 父版本 ${v.parentVersionId.slice(0, 8)}`}
                                    </p>
                                    {v.sourceType !== "import" && (
                                      <pre>
                                        {JSON.stringify(
                                          JSON.parse(v.paramsSnapshot),
                                          null,
                                          2,
                                        )}
                                      </pre>
                                    )}
                                    <small>
                                      每次创作独立保存，原始音频不会被覆盖。
                                    </small>
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      )
                    ) : (
                      <div className="job-list">
                        {!project.jobs.length ? (
                          <div className="results-empty panel">
                            <Clock3 size={32} />
                            <h3>还没有生成记录</h3>
                            <p>提交创作后，可以在这里查看进度。</p>
                          </div>
                        ) : (
                          project.jobs.map((job) => (
                            <article className="job-card panel" key={job.id}>
                              <div className="job-heading">
                                <div className="job-model">
                                  <span className="heading-icon">
                                    <Music2 size={16} />
                                  </span>
                                  <div>
                                    <strong>
                                      {job.provider === "mock"
                                        ? "演示创作"
                                        : job.model}
                                    </strong>
                                    <small>{dateLabel(job.createdAt)}</small>
                                  </div>
                                </div>
                                <span
                                  className={`job-status status-${job.status}`}
                                >
                                  {[
                                    "uploading",
                                    "submitting",
                                    "running",
                                    "downloading",
                                  ].includes(job.status) && (
                                    <LoaderCircle size={12} className="spin" />
                                  )}
                                  {statusLabels[job.status] || job.status}
                                </span>
                              </div>
                              {job.status === "queued" && (
                                <p className="hint">
                                  {state.workerOnline
                                    ? "任务将在前一个创作完成后开始"
                                    : "等待本地创作服务启动"}
                                </p>
                              )}
                              {job.status === "submitting" && (
                                <p className="hint">
                                  音乐正在创作中，通常需要约一分钟；最长等待
                                  10–11 分钟。
                                </p>
                              )}
                              {job.outputs.map((o) => (
                                <div className="output-progress" key={o.id}>
                                  <div>
                                    <span>候选 {o.index + 1}</span>
                                    <span>
                                      {o.status === "completed"
                                        ? "已保存"
                                        : o.status === "failed"
                                          ? "下载失败"
                                          : o.totalBytes
                                            ? `${Math.round((o.receivedBytes / o.totalBytes) * 100)}%`
                                            : `${(o.receivedBytes / 1024 / 1024).toFixed(1)} MB`}
                                    </span>
                                  </div>
                                  <progress
                                    aria-label={`候选 ${o.index + 1} 下载进度`}
                                    value={
                                      o.status === "completed"
                                        ? 1
                                        : o.totalBytes
                                          ? o.receivedBytes / o.totalBytes
                                          : 0
                                    }
                                    max="1"
                                  />
                                  {o.errorMessage && (
                                    <p className="job-error">
                                      {o.errorMessage}
                                    </p>
                                  )}
                                </div>
                              ))}
                              {job.errorMessage && (
                                <p className="job-error">{job.errorMessage}</p>
                              )}
                              <div className="job-actions">
                                {job.status === "download_failed" && (
                                  <button
                                    className="button small secondary"
                                    disabled={busy}
                                    onClick={() =>
                                      void action(async () => {
                                        await api(
                                          `jobs/${job.id}/retry-download`,
                                          "POST",
                                        );
                                        await refresh();
                                      })
                                    }
                                  >
                                    <RotateCcw size={13} />
                                    仅重试下载 · 不重新生成
                                  </button>
                                )}
                                {job.status === "queued" && (
                                  <button
                                    className="text-button"
                                    disabled={busy}
                                    onClick={() =>
                                      void action(async () => {
                                        await api(
                                          `jobs/${job.id}/cancel`,
                                          "POST",
                                        );
                                        await refresh();
                                      })
                                    }
                                  >
                                    <Square size={12} />
                                    取消排队
                                  </button>
                                )}
                                <button
                                  className="text-button"
                                  disabled={archived || busy}
                                  onClick={() =>
                                    job.provider === "suno-api"
                                      ? void launch(
                                          JSON.parse(job.requestParams).kind ===
                                            "hum_cover"
                                            ? "ai_cover"
                                            : "ai_replace",
                                        )
                                      : reuse(job.requestParams, job.id)
                                  }
                                >
                                  <Copy size={13} />
                                  {job.provider === "suno-api"
                                    ? "查看 AI 任务"
                                    : "载入参数"}
                                </button>
                                {job.status === "succeeded" && (
                                  <button
                                    className="text-button orange-text"
                                    onClick={() => setTab("versions")}
                                  >
                                    试听作品 <ArrowUpRight size={13} />
                                  </button>
                                )}
                              </div>
                            </article>
                          ))
                        )}
                      </div>
                    )}
                    <div className="studio-note">
                      <span className="note-star">✳</span>
                      <div>
                        <strong>每一次尝试，都值得被保留。</strong>
                        <p>
                          所有生成和导入都会成为独立版本。选定你喜欢的声音，随时回来继续创作。
                        </p>
                      </div>
                    </div>
                    <div className="capability-note">
                      <CircleHelp size={14} />
                      <span>AI 哼唱成曲与段落重写已开放实验入口</span>
                      <span className="coming-soon">需配置音频服务 Key</span>
                    </div>
                  </section>
                </div>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>SONG STUDIO</span>
            <span>把灵感变成声音。</span>
            <AudioLines size={16} />
          </footer>
        </div>
      </main>
      {(newDialog || renameDialog) && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) {
              setNewDialog(false);
              setRenameDialog(false);
            }
          }}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            onKeyDown={(e) => {
              if (e.key === "Escape" && !busy) {
                setNewDialog(false);
                setRenameDialog(false);
              }
            }}
          >
            <button
              className="icon-button modal-close"
              aria-label="关闭对话框"
              onClick={() => {
                setNewDialog(false);
                setRenameDialog(false);
              }}
            >
              <X size={18} />
            </button>
            <span className="heading-icon">
              <Music2 size={22} />
            </span>
            <h2 id="dialog-title">
              {newDialog ? "为新灵感起个名字" : "重命名歌曲项目"}
            </h2>
            <p>
              {newDialog
                ? "名字可以随时修改，先把这一刻的想法留下来。"
                : "让名字更贴近你的创作。"}
            </p>
            <form
              onSubmit={
                newDialog
                  ? createProject
                  : (e) => {
                      e.preventDefault();
                      void action(async () => {
                        await api(`projects/${project!.id}`, "PATCH", {
                          name: renameName,
                        });
                        setRenameDialog(false);
                        await refresh();
                      });
                    }
              }
            >
              <label htmlFor="project-name">项目名称</label>
              <input
                id="project-name"
                autoFocus
                required
                maxLength={100}
                placeholder="比如：回家的路"
                value={newDialog ? newName : renameName}
                onChange={(e) =>
                  newDialog
                    ? setNewName(e.target.value)
                    : setRenameName(e.target.value)
                }
              />
              <button
                className="button primary"
                disabled={busy || !(newDialog ? newName : renameName).trim()}
                type="submit"
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Plus size={16} />
                )}
                {newDialog ? "创建项目" : "保存名称"}
              </button>
            </form>
            {error && (
              <p className="job-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
