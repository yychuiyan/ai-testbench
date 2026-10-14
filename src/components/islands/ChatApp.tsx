import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { t } from '../../lib/i18n';
import {
  loadSettings,
  onSettingsChanged,
  openSettings,
  patchSettings,
  applyGeneralPrefs,
  hydrateAppConfig,
  loadAccessLevel,
  loadGeneralPrefs,
  onAccessLevelChanged,
  onGeneralPrefsChanged,
  saveAccessLevel,
  type AccessLevel,
  type BusySendBehavior,
  type GeneralPrefs,
  type LLMSettings,
  type ReasoningEffort,
} from '../../lib/settings';
import {
  streamChatWithTools,
  fetchModels,
  MODEL_CONTEXT_WINDOW,
  type ChatMessage,
  type ContentPart,
  type ToolDef,
  type UsageInfo,
} from '../../lib/llm';
import { renderMarkdown } from '../../lib/markdown-client';
import {
  archiveSession,
  createSession,
  deleteSession,
  hydrateSessionStore,
  isEphemeralEmptySession,
  loadRailOpen,
  pinSession,
  renameSession,
  restoreDeletedSession,
  saveRailOpen,
  saveSessionStore,
  softDeleteSession,
  sortSessionsInGroup,
  switchSession,
  unbindSessionsFromWorkspace,
  updateActiveMessages,
  updateActiveSessionMeta,
  type ChatSession,
  type SessionStore,
} from '../../lib/sessions';
import { caseGenConfigLabel, type CaseGenPluginConfig } from '../../lib/case-gen-config';
import {
  buildCaseGenSystemPrompt,
  formatCaseGenProgress,
  tryFinishCaseGenFromAssistant,
} from '../../lib/case-gen-run';
import { promptGenConfigLabel, type PromptGenPluginConfig } from '../../lib/prompt-gen-config';
import {
  buildPromptGenSystemPrompt,
  formatPromptGenProgress,
  tryFinishPromptGenFromAssistant,
} from '../../lib/prompt-gen-run';
import {
  knowledgeGenConfigLabel,
  type KnowledgeGenPluginConfig,
} from '../../lib/knowledge-gen-config';
import {
  buildKnowledgeGenSystemPrompt,
  formatKnowledgeGenProgress,
  tryFinishKnowledgeGenFromAssistant,
} from '../../lib/knowledge-gen-run';
import {
  FS_SYSTEM_HINT,
  addWorkspace,
  fetchFsHealth,
  fetchWorkspace,
  fsToolsForAccess,
  listWorkspaceFlat,
  pickDirectory,
  removeWorkspace,
  renameWorkspace,
  runFsTool,
  selectWorkspace,
  shortWorkspaceLabel,
  type FsHealth,
  type WorkspaceFlatEntry,
  type WorkspaceInfo,
  type WorkspaceItem,
} from '../../lib/fs-tools';
import {
  MEMORY_TOOLS,
  MEMORY_SYSTEM_HINT,
  MEMORY_KEEP_RECENT,
  deleteSessionMemory,
  fetchMemoryHealth,
  maybeCaptureMemory,
  recallMemory,
  runMemoryTool,
  type MemoryHealth,
} from '../../lib/memory';
import {
  loadPluginEnabled,
  onPluginEnabledChanged,
  pluginDisabledMessage,
  PLUGIN_CATALOG,
  type PluginId,
} from '../../lib/plugins';
import { docRootLabel, docRootLabelPath } from '../../lib/doc-roots';
import { KB_SYSTEM_HINT, KB_TOOLS, runKnowledgeTool } from '../../lib/knowledge-tools';
import { CHAT_SYSTEM_PROMPT_FILE, DEFAULT_CHAT_SYSTEM_PROMPT } from '../../lib/prompts-meta';
import { fetchDocsHealth, openDocsFile, readDocsText } from '../../lib/project-docs';
import { formatSlashBadge, matchSlashQuery, type SlashDocItem } from '../../lib/slash-docs-shared';
import {
  ATTACH_ACCEPT_EXTS,
  FILE_MAX_BYTES,
  FILE_MAX_COUNT,
  readLocalAttachFile,
} from '../../lib/attach-read';
import CaseGenPanel from './CaseGenPanel';
import PromptGenPanel from './PromptGenPanel';
import KnowledgeGenPanel from './KnowledgeGenPanel';
import PluginsPage from './PluginsPage';
import ConfirmDialog from './ConfirmDialog';
import MemoryPane from './MemoryPane';
import NamePromptDialog from './NamePromptDialog';

export type SlashDoc = SlashDocItem;

/** 侧栏「未分组」折叠键 */
const UNGROUPED_KEY = '__ungrouped__';

/** 「@」选中的文档引用（项目文档 → kb_read；工作区 → fs_read） */
interface DocRef {
  collection: 'knowledge' | 'templates' | 'workspace';
  id: string;
  title: string;
  category: string;
  path: string;
  format: string;
}

function buildPluginMessages(
  systemPrompt: string,
  allApiMessages: ChatMessage[],
  opts: { memory: boolean; knowledge: boolean; fs: boolean },
): ChatMessage[] {
  let system = systemPrompt;
  if (opts.knowledge) system = `${system}\n\n${KB_SYSTEM_HINT}`;
  if (opts.fs) system = `${system}\n\n${FS_SYSTEM_HINT}`;
  if (opts.memory) system = `${system}\n\n${MEMORY_SYSTEM_HINT}`;
  const recent = opts.memory ? allApiMessages.slice(-MEMORY_KEEP_RECENT) : allApiMessages;
  return [{ role: 'system', content: system }, ...recent];
}

/** 末尾单独「/」：唤起已启用的面板型插件 */
function getPluginSlashState(text: string): { from: number } | null {
  if (!/(?:^|[\s\n])\/$/.test(text)) return null;
  const from = text.lastIndexOf('/');
  return from < 0 ? null : { from };
}

/** 「@」引用文档：支持 @ 后跟搜索关键字 */
function getAtMentionState(text: string): { from: number; query: string } | null {
  const m = /(?:^|[\s\n])@([^\s@]*)$/.exec(text);
  if (!m) return null;
  const from = text.lastIndexOf('@');
  if (from < 0) return null;
  return { from, query: m[1] ?? '' };
}

const FALLBACK_SYSTEM_PROMPT = DEFAULT_CHAT_SYSTEM_PROMPT;

/** 附加到消息的文本文件（读入内容随消息发送给模型） */
interface Attachment {
  name: string;
  size: number;
  content: string;
}

/** 粘贴 / 选取的图片（data URL，本地会话可整图保存） */
interface ImageAtt {
  id: string;
  name: string;
  size: number;
  mime: string;
  dataUrl: string;
}

/** 本地消息：展示用 content 恒为 string；发 API 时再组多模态 */
interface LocalMessage extends Omit<ChatMessage, 'content'> {
  content: string;
  reasoning?: string;
  /** 思考耗时（秒）：首个 reasoning chunk 到首个正文 chunk 的间隔 */
  reasoningDuration?: number;
  /** 思考块展开状态，默认收起 */
  reasoningOpen?: boolean;
  /** 消息时间（ms）：用户为发送时刻，助手为完成时刻 */
  time?: number;
  usage?: UsageInfo;
  /** 输出速度（tokens/s）：completion_tokens / 首 token 到结束的时长 */
  tps?: number;
  /** 请求发出到首个流式 chunk 的耗时（ms） */
  ttftMs?: number;
  /** 请求发出到流结束的壁钟耗时（ms） */
  llmMs?: number;
  /** 本轮使用的模型 id（切换模型后历史轮次仍显示当时模型） */
  model?: string;
  attachments?: Attachment[];
  /** 「/」文档引用 */
  refs?: DocRef[];
  images?: ImageAtt[];
  /** 用例生成插件入库的文件（展示卡片，双击本地打开） */
  caseFile?: { path: string; name: string; count: number };
  /** 提示词 / 知识库等入库文件（展示卡片，点击本地打开） */
  docsFile?: {
    root: 'prompts' | 'knowledge';
    path: string;
    name: string;
    /** 副标题补充，如分类 */
    note?: string;
  };
}

const REF_MAX_COUNT = 5;
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];

/** 文本侧正文：引用路径 + 文本附件；图片走多模态字段 */
function toApiText(m: LocalMessage): string {
  const parts: string[] = [];
  if (m.content) parts.push(m.content);
  if (m.refs?.length) {
    const projectRefs = m.refs.filter((r) => r.collection !== 'workspace');
    const wsRefs = m.refs.filter((r) => r.collection === 'workspace');
    if (projectRefs.length) {
      const lines = projectRefs.map(
        (r) => `- ${r.path} 《${r.title}》（${r.category} · ${formatSlashBadge(r.format)}）`,
      );
      parts.push(`引用项目文档（请使用 kb_read 读取）：\n${lines.join('\n')}`);
    }
    if (wsRefs.length) {
      const lines = wsRefs.map(
        (r) => `- ${r.path} 《${r.title}》（${r.format === 'dir' ? '文件夹' : '文件'}）`,
      );
      parts.push(`引用工作区路径（请使用 fs_list / fs_read）：\n${lines.join('\n')}`);
    }
  }
  if (m.attachments?.length) {
    parts.push(
      m.attachments
        .map((a) => `附件《${a.name}》：\n\`\`\`\`\n${a.content}\n\`\`\`\``)
        .join('\n\n'),
    );
  }
  return parts.join('\n\n');
}

/** 组装发给模型的 content（有图则为多模态数组） */
function toApiMessageContent(m: LocalMessage): ChatMessage['content'] {
  const text = toApiText(m);
  if (!m.images?.length) return text;
  const parts: ContentPart[] = [];
  if (text) parts.push({ type: 'text', text });
  else parts.push({ type: 'text', text: '请查看图片。' });
  for (const img of m.images) {
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  }
  return parts;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

async function fileToImageAtt(file: File): Promise<ImageAtt> {
  if (!IMAGE_MIME.includes(file.type) && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
    throw new Error(`${file.name || '图片'}：不支持的格式`);
  }
  if (file.size > FILE_MAX_BYTES) {
    throw new Error(`${file.name || '图片'}：超过 ${Math.round(FILE_MAX_BYTES / 1024 / 1024)} MB`);
  }
  const dataUrl = await readFileAsDataUrl(file);
  if (!dataUrl.startsWith('data:image/')) throw new Error('无法识别为图片');
  return {
    id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: file.name || `paste-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.png`,
    size: file.size,
    mime: file.type || 'image/png',
    dataUrl,
  };
}

function composerFileCount(atts: Attachment[], imgs: ImageAtt[]): number {
  return atts.length + imgs.length;
}

/**
 * 思考中流式摘要：取最近一个「已完成段落」的第一行，随流式推进滚动更新。
 * 逻辑移植自 deepseek-harness ReasoningRow.latestCompletedParagraphFirstLine：
 * 以空行分段，最后完整段落的首行即为当前摘要。
 */
function latestParagraphFirstLine(text: string): string {
  let summary = '';
  let paragraphStart = 0;
  const separator = /\r?\n(?:[\t ]*\r?\n)+/g;
  for (;;) {
    const next = separator.exec(text);
    const paragraphEnd = next === null ? text.length : next.index + next[0].indexOf('\n');
    const newline = text.indexOf('\n', paragraphStart);
    if (newline !== -1 && newline <= paragraphEnd) {
      const candidate = text.slice(paragraphStart, newline).trim();
      if (candidate !== '') summary = candidate;
    }
    if (next === null) return summary;
    paragraphStart = next.index + next[0].length;
  }
}

const SUGGESTIONS = [
  '帮我为「用户登录」功能梳理测试点',
  '支付回调接口应该设计哪些异常场景用例？',
  '给我一份缺陷报告的标准字段模板',
  '边界值分析法和等价类划分怎么结合使用？',
];

/** 推理等级（DeepSeek reasoning_effort 有效值 low/high/max） */
const EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string; desc: string }> = [
  { value: 'low', label: 'Low', desc: '响应更快，适合简单问答' },
  { value: 'high', label: 'High', desc: '质量与速度均衡（默认）' },
  { value: 'max', label: 'Max', desc: '最深推理，适合复杂分析' },
];

/** 访问权限（对齐 dsh；需 npm run dev 本地 Runner） */
const ACCESS_OPTIONS: Array<{ value: AccessLevel; label: string }> = [
  { value: 'readonly', label: '仅可查看' },
  { value: 'readwrite', label: '工作区内修改' },
  { value: 'full', label: '完全权限' },
];

function toolKindLabel(name: string): string {
  if (name.startsWith('kb_')) return t('tool.kind.kb');
  if (name.startsWith('fs_')) return t('tool.kind.fs');
  return t('tool.kind.memory');
}

/** 按「工作步骤展示」偏好生成工具提示 */
function toolStepHint(
  detail: GeneralPrefs['toolStepDetail'],
  kind: string,
  name: string,
  status: 'running' | 'done',
): string | null {
  if (detail === 'concise') {
    return status === 'running' ? t('tool.running') : null;
  }
  if (detail === 'standard') {
    return status === 'running' ? t('tool.callingKind', { kind }) : t('tool.doneKind', { kind });
  }
  if (detail === 'detailed') {
    return status === 'running'
      ? t('tool.callingNamed', { kind, name })
      : t('tool.doneNamed', { kind, name });
  }
  // full：完成态也保留，文案更完整
  return status === 'running'
    ? t('tool.callingFull', { kind, name })
    : t('tool.doneFull', { kind, name });
}

function Svg({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ChevronIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
const ChevronRightIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);
const CheckIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
const CopyIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </Svg>
);
const DatabaseIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14a9 3 0 0 0 18 0V5" />
    <path d="M3 12a9 3 0 0 0 18 0" />
  </Svg>
);
const GaugeIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <path d="m12 14 4-4" />
    <path d="M3.34 19a10 10 0 1 1 17.32 0" />
  </Svg>
);
const FileIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
  </Svg>
);
const PaperclipIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <path d="m16.5 9.4-7.07 7.07a3 3 0 0 1-4.24-4.24l7.07-7.07a2 2 0 1 1 2.83 2.83L8.02 14.1a1 1 0 0 1-1.41-1.41l7.07-7.07" />
  </Svg>
);
const FolderIcon = ({ className = '', open = false }: { className?: string; open?: boolean }) => (
  <Svg className={className}>
    {open ? (
      <>
        <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6A2 2 0 0 1 18.45 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.69.9H18a2 2 0 0 1 2 2v2" />
      </>
    ) : (
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9l-.81-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    )}
  </Svg>
);
/** dsh 风格展开三角：默认朝右，展开旋转 90° 朝下 */
const TriangleChevron = ({
  className = '',
  open = false,
}: {
  className?: string;
  open?: boolean;
}) => (
  <svg
    className={`${className} tw-arrow ${open ? 'is-open' : ''}`}
    viewBox="0 0 12 12"
    fill="currentColor"
    aria-hidden
  >
    <path d="M4.2 2.4a.75.75 0 0 1 1.2-.57l4.2 3.35a.75.75 0 0 1 0 1.14l-4.2 3.35A.75.75 0 0 1 4.2 9.1V2.9Z" />
  </svg>
);
const SearchIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);
const PlusSquareIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M12 8v8" />
    <path d="M8 12h8" />
  </Svg>
);
const PinIcon = ({ className = '', filled = false }: { className?: string; filled?: boolean }) => (
  <Svg className={className}>
    {filled ? (
      <path
        fill="currentColor"
        stroke="none"
        d="M12 2a3 3 0 0 1 3 3v3.5l2.5 2.5V13h-3.5V20l-1.5 2-1.5-2v-7H7.5v-2L10 8.5V5a3 3 0 0 1 3-3Z"
      />
    ) : (
      <path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2z" />
    )}
  </Svg>
);
const EllipsisIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
  </Svg>
);
const ArchiveBoxIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <path d="M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z" />
    <path d="M8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3" />
    <path d="M10 12h4" />
  </Svg>
);
const PluginIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </Svg>
);
/** dsh 风格相对时间：19天 / 1个月 */
function relTimeLabel(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分钟`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}天`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}个月`;
  return `${Math.floor(mon / 12)}年`;
}

function relTimePreviewLabel(ts: number): string {
  const base = relTimeLabel(ts);
  if (base === '刚刚') return '刚刚';
  if (base.endsWith('前')) return base;
  return `${base}前`;
}

/** 会话行：悬停滚动长标题 + 右侧预览（标题/时间/状态） */
function SessionRailRow({
  s,
  nested = false,
  active,
  menuOpen,
  busy,
  onOpen,
  onRename,
  onToggleMenu,
  onTogglePin,
  onToggleArchive,
  onRemove,
  onRestore,
}: {
  s: ChatSession;
  nested?: boolean;
  active: boolean;
  menuOpen: boolean;
  busy: boolean;
  onOpen: () => void;
  onRename: () => void;
  onToggleMenu: () => void;
  onTogglePin: () => void;
  onToggleArchive: () => void;
  onRemove: () => void;
  onRestore?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const titleBtnRef = useRef<HTMLButtonElement>(null);
  const titleInnerRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [hover, setHover] = useState(false);
  const [previewPos, setPreviewPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const btn = titleBtnRef.current;
    const inner = titleInnerRef.current;
    if (!btn || !inner) return;
    const measure = () => {
      // 临时取消省略限制，量真实文案宽度
      inner.style.maxWidth = 'none';
      inner.style.overflow = 'visible';
      inner.style.display = 'inline-block';
      const full = inner.scrollWidth;
      inner.style.maxWidth = '';
      inner.style.overflow = '';
      inner.style.display = '';
      const view = btn.clientWidth;
      const overflowing = full > view + 1;
      setOverflow(overflowing);
      if (overflowing) {
        inner.style.setProperty('--tw-marquee-shift', `${Math.min(0, view - full - 28)}px`);
      } else {
        inner.style.removeProperty('--tw-marquee-shift');
      }
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(btn);
    return () => ro?.disconnect();
  }, [s.title]);

  useLayoutEffect(() => {
    if (!hover || menuOpen) {
      setPreviewPos(null);
      return;
    }
    const place = () => {
      const el = rowRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPreviewPos({ top: r.top + r.height / 2, left: r.right + 8 });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [hover, menuOpen, s.title]);

  const statusLabel = busy ? '生成中' : '空闲';
  const dimmed = Boolean(s.archived || s.deleted);

  return (
    <div
      ref={rowRef}
      className={`tw-session-row relative ${nested ? 'is-nested' : ''} ${
        active ? 'is-selected' : ''
      } ${menuOpen ? 'is-menu-open' : ''} ${dimmed ? 'opacity-50' : ''}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {s.pinned && !dimmed ? (
        <span className="tw-slot" aria-hidden>
          <PinIcon filled className="tw-pin-indicator w-3 h-3" />
        </span>
      ) : null}
      <button
        ref={titleBtnRef}
        type="button"
        onClick={onOpen}
        onDoubleClick={onRename}
        className={`tw-session-title text-left outline-none focus:outline-none focus-visible:outline-none ${
          overflow ? 'is-overflow' : ''
        }`}
      >
        <span ref={titleInnerRef} className="tw-session-title-inner">
          {s.title}
        </span>
      </button>
      <span className="tw-session-time pr-1">{relTimeLabel(s.updatedAt)}</span>
      <div
        data-session-menu=""
        className="tw-row-actions items-center gap-0.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative">
          <button
            type="button"
            title="更多"
            onClick={onToggleMenu}
            className="tw-session-action-btn w-6 h-6 flex items-center justify-center rounded"
          >
            <EllipsisIcon className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <div className="tw-popover absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-stone-200 py-1 shadow-lg">
              {s.deleted ? (
                <>
                  {onRestore ? (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-stone-700 hover:bg-stone-50"
                      onClick={onRestore}
                    >
                      恢复会话
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50"
                    onClick={onRemove}
                  >
                    永久删除
                  </button>
                </>
              ) : (
                <>
                  {!s.archived && (
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-stone-700 hover:bg-stone-50"
                      onClick={onTogglePin}
                    >
                      <PinIcon filled={Boolean(s.pinned)} className="w-3.5 h-3.5" />
                      {s.pinned ? '取消置顶' : '置顶会话'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-stone-700 hover:bg-stone-50"
                    onClick={onRename}
                  >
                    <Svg className="w-3.5 h-3.5">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </Svg>
                    重命名
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-stone-700 hover:bg-stone-50"
                    onClick={onToggleArchive}
                  >
                    <ArchiveBoxIcon className="w-3.5 h-3.5" />
                    {s.archived ? '取消归档' : '归档会话'}
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50"
                    onClick={onRemove}
                  >
                    <Svg className="w-3.5 h-3.5">
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                    </Svg>
                    删除
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        {!s.deleted && (
          <button
            type="button"
            title={s.archived ? '取消归档' : '归档'}
            onClick={onToggleArchive}
            className="tw-session-action-btn w-6 h-6 flex items-center justify-center rounded"
          >
            <ArchiveBoxIcon className="w-3.5 h-3.5" />
          </button>
        )}
        {!s.archived && !s.deleted && (
          <button
            type="button"
            title={s.pinned ? '取消置顶' : '置顶'}
            onClick={onTogglePin}
            className="tw-session-action-btn w-6 h-6 flex items-center justify-center rounded"
          >
            <PinIcon filled={Boolean(s.pinned)} className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {hover && !menuOpen && previewPos && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="tw-session-preview"
              role="tooltip"
              style={{
                position: 'fixed',
                top: previewPos.top,
                left: previewPos.left,
                transform: 'translateY(-50%)',
              }}
            >
              <div className="tw-session-preview-title">{s.title}</div>
              <div className="tw-session-preview-meta">{relTimePreviewLabel(s.updatedAt)}</div>
              <div className={`tw-session-preview-status ${busy ? 'is-busy' : ''}`}>
                {statusLabel}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
const SHIELD_PATH =
  'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z';
function ShieldIcon({ level, className = '' }: { level: AccessLevel; className?: string }) {
  return (
    <Svg className={className}>
      <path d={SHIELD_PATH} />
      {level === 'readonly' && <path d="m9 12 2 2 4-4" />}
      {level === 'readwrite' && (
        <>
          <path d="M9 10h6" />
          <path d="M9 14h3" />
        </>
      )}
      {level === 'full' && (
        <>
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </>
      )}
    </Svg>
  );
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtExactTokens(n: number): string {
  return `${n.toLocaleString('en-US')} tok`;
}

/** 紧凑时长：不足 1 分钟用秒，否则「X 分 Y 秒」 */
function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s * 10) / 10} 秒`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)} 分 ${whole % 60} 秒`;
}

function fmtPct(n: number): string {
  if (n >= 99.95) return '100';
  if (n >= 10) return String(Math.round(n));
  return n.toFixed(1);
}

/** 粗估中文为主文本的 token 数（API 不披露上下文分段时，仅用于占用条示意） */
function estimateTokens(text: string): number {
  let n = 0;
  for (const ch of text) n += /[\u4e00-\u9fff]/.test(ch) ? 1 : 0.25;
  return Math.max(1, Math.round(n));
}

function uncachedOf(u: UsageInfo): number {
  if (u.uncachedTokens != null) return u.uncachedTokens;
  if (u.cachedTokens != null) return Math.max(0, u.promptTokens - u.cachedTokens);
  return u.promptTokens;
}

function cacheHitPct(cached: number, prompt: number): number | null {
  if (prompt <= 0) return null;
  return (cached / prompt) * 100;
}

function fmtSize(bytes: number): string {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

/** 消息时间：当天显示 HH:mm，跨天显示 M/D HH:mm */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return d.toDateString() === new Date().toDateString()
    ? hm
    : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 复制按钮（dsh MessageIconActions）：
 * 点击复制 → 对勾停留 1 秒切回；成功窗口内不重复触发。
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function onCopy() {
    if (copied) return;
    if (!(await copyText(text))) return;
    setCopied(true);
    timerRef.current = window.setTimeout(() => setCopied(false), 1000);
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      title={copied ? '已复制' : '复制'}
      className="tw-icon-btn w-7 h-7 flex items-center justify-center rounded-md transition-colors"
    >
      {copied ? (
        <CheckIcon className="w-[15px] h-[15px] text-emerald-600" />
      ) : (
        <CopyIcon className="w-[15px] h-[15px]" />
      )}
    </button>
  );
}

/** 上下文占用环 */
function Ring({ pct }: { pct: number }) {
  return (
    <svg className="w-3.5 h-3.5 -rotate-90" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="var(--color-stone-200)" strokeWidth="3" />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="#4176e6"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${(Math.max(pct, 1) / 100) * 50.27} 50.27`}
      />
    </svg>
  );
}

/**
 * 统计弹层座位（dsh useStatDialog 精简版）：
 * 触发器上方锚定、视口夹紧、点击外部 / Escape 关闭。
 */
function useStatDialog() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<CSSProperties | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = rootRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const gap = 8;
      const margin = 12;
      let left = a.left + a.width / 2 - p.width / 2;
      left = Math.max(margin, Math.min(left, window.innerWidth - p.width - margin));
      let top = a.top - p.height - gap;
      if (top < margin) top = a.bottom + gap;
      setPos({ position: 'fixed', left, top, visibility: 'visible' });
    };
    // 先隐藏测量再定位，避免首帧闪在 (0,0)
    setPos({ position: 'fixed', left: 0, top: 0, visibility: 'hidden' });
    const raf = requestAnimationFrame(place);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick, true);
    };
  }, [open]);

  return { open, setOpen, rootRef, panelRef, pos };
}

function StatDialog({
  title,
  titleValue,
  icon,
  children,
}: {
  title: string;
  titleValue?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="tw-popover w-[min(320px,calc(100vw-24px))] rounded-2xl border border-stone-200 p-3.5 shadow-xl text-left">
      <div className="flex items-center gap-2 text-[13px]">
        {icon}
        <span className="tw-popover-title font-medium text-stone-800">{title}</span>
        {titleValue !== undefined && (
          <span className="tw-popover-muted ml-auto text-stone-500 tabular-nums">{titleValue}</span>
        )}
      </div>
      <div className="mt-2.5 mb-2.5 border-t border-stone-100" />
      {children}
    </div>
  );
}

function StatRows({ rows }: { rows: Array<{ label: string; value: string; hide?: boolean }> }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[13px]">
      {rows
        .filter((r) => !r.hide)
        .map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-stone-500">{r.label}</dt>
            <dd className="text-stone-800 tabular-nums text-right">{r.value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** 可点击统计触发器：pill=状态栏胶囊；ghost=消息行轻量文字（对齐 dsh 用量样式） */
function DialogPill({
  label,
  icon,
  ariaLabel,
  title,
  titleValue,
  children,
  variant = 'pill',
}: {
  label: ReactNode;
  icon: ReactNode;
  ariaLabel: string;
  title: string;
  titleValue?: string;
  children: ReactNode;
  variant?: 'pill' | 'ghost';
}) {
  const { open, setOpen, rootRef, panelRef, pos } = useStatDialog();
  const btnCls =
    variant === 'ghost'
      ? `inline-flex items-center gap-1 text-xs tabular-nums transition-colors ${
          open ? 'text-stone-600' : 'text-stone-400 hover:text-stone-600'
        }`
      : `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-colors ${
          open ? 'bg-stone-200/70 text-stone-600' : 'hover:bg-stone-200/60 hover:text-stone-600'
        }`;
  return (
    <span ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        className={btnCls}
      >
        {icon}
        <span>{label}</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={title}
            style={pos ?? { position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
            className="z-[80]"
          >
            <StatDialog title={title} titleValue={titleValue} icon={icon}>
              {children}
            </StatDialog>
          </div>,
          document.body,
        )}
    </span>
  );
}

/**
 * 输入框下方状态栏（dsh StatsPills）：三枚胶囊均可点击查看详情。
 * 数据全部来自本会话真实请求用量 / 计时，不是写死常量。
 */
function StatusBar({
  messages,
  model,
  systemPromptTokens,
}: {
  messages: LocalMessage[];
  model: string | undefined;
  systemPromptTokens: number;
}) {
  const answered = messages.filter((m) => m.role === 'assistant' && m.usage);
  if (!answered.length) return null;
  const last = answered[answered.length - 1];
  const turns = messages.filter((m) => m.role === 'user').length;
  // 「步」= 助手完成轮次（有用量的回答），对齐 dsh steps
  const steps = answered.length;
  const total = answered.reduce((s, m) => s + (m.usage?.totalTokens ?? 0), 0);
  const promptSum = answered.reduce((s, m) => s + (m.usage?.promptTokens ?? 0), 0);
  const cachedSum = answered.reduce((s, m) => s + (m.usage?.cachedTokens ?? 0), 0);
  const uncachedSum = answered.reduce((s, m) => s + (m.usage ? uncachedOf(m.usage) : 0), 0);
  const cacheWriteSum = answered.reduce((s, m) => s + (m.usage?.cacheWriteTokens ?? 0), 0);
  const outputSum = answered.reduce((s, m) => s + (m.usage?.completionTokens ?? 0), 0);
  const cacheKnown = answered.some((m) => m.usage?.cachedTokens != null);
  const hit = cacheKnown ? cacheHitPct(cachedSum, promptSum) : null;
  const llmMs = answered.reduce((s, m) => s + (m.llmMs ?? 0), 0);
  const ttftList = answered.map((m) => m.ttftMs).filter((n): n is number => n != null && n > 0);
  const avgTtft = ttftList.length ? ttftList.reduce((a, b) => a + b, 0) / ttftList.length : 0;
  // 会话输出速度：优先用解码时长加权；否则用各轮 tps 均值
  const decodeMs = answered.reduce((s, m) => {
    if (m.llmMs == null || m.ttftMs == null) return s;
    return s + Math.max(0, m.llmMs - m.ttftMs);
  }, 0);
  const tpsSamples = answered.map((m) => m.tps).filter((n): n is number => n != null && n > 0);
  const avgTps = tpsSamples.length
    ? tpsSamples.reduce((a, b) => a + b, 0) / tpsSamples.length
    : undefined;
  const sessionTps = decodeMs > 200 ? outputSum / (decodeMs / 1000) : (avgTps ?? last.tps);
  const windowSize = model ? MODEL_CONTEXT_WINDOW[model] : undefined;
  const ctxTokens = last.usage?.promptTokens ?? 0;
  const pct = windowSize ? Math.min(100, (ctxTokens / windowSize) * 100) : undefined;
  const sysTokens = Math.min(systemPromptTokens, ctxTokens);
  const convTokens = Math.max(0, ctxTokens - sysTokens);

  return (
    <div className="flex items-center justify-center gap-1 pt-2 text-xs text-stone-400 tabular-nums select-none">
      <DialogPill
        icon={<GaugeIcon className="w-3.5 h-3.5" />}
        label={
          <>
            {turns} 轮 {steps} 步{sessionTps ? ` · ${Math.round(sessionTps)} tok/s` : ''}
          </>
        }
        ariaLabel="会话统计"
        title="会话统计"
      >
        <StatRows
          rows={[
            { label: '模型用时', value: llmMs > 0 ? fmtDuration(llmMs) : '—' },
            { label: '工具调用用时', value: '—' },
            {
              label: '首 token 平均 (TTFT)',
              value: ttftList.length ? fmtDuration(avgTtft) : '—',
            },
            {
              label: '输出速度 (TPS)',
              value: sessionTps ? `${Math.round(sessionTps)} tok/s` : '—',
            },
          ]}
        />
      </DialogPill>

      <DialogPill
        icon={<DatabaseIcon className="w-3.5 h-3.5" />}
        label={
          <>
            {fmtTokens(total)} tok
            {hit != null ? ` · 缓存命中 ${fmtPct(hit)}%` : ''}
          </>
        }
        ariaLabel="Token 用量"
        title="Token 用量"
        titleValue={fmtExactTokens(total)}
      >
        <StatRows
          rows={[
            { label: '缓存命中', value: hit != null ? `${fmtPct(hit)}%` : '—', hide: hit == null },
            { label: '未缓存输入', value: fmtExactTokens(uncachedSum) },
            { label: '缓存读取', value: fmtExactTokens(cachedSum), hide: !cacheKnown },
            { label: '缓存写入', value: fmtExactTokens(cacheWriteSum), hide: cacheWriteSum <= 0 },
            { label: '输出', value: fmtExactTokens(outputSum) },
          ]}
        />
      </DialogPill>

      {pct !== undefined && windowSize && (
        <DialogPill
          icon={<Ring pct={pct} />}
          label={`${fmtPct(pct)}%`}
          ariaLabel="上下文占用"
          title={`上下文已用 ${fmtPct(pct)}%`}
          titleValue={`~${fmtTokens(ctxTokens)} / ${fmtTokens(windowSize)}`}
        >
          <div className="h-2 rounded-full bg-stone-100 overflow-hidden flex mb-3">
            <span
              className="h-full bg-stone-400"
              style={{ width: `${(sysTokens / windowSize) * 100}%` }}
              title="系统提示词"
            />
            <span
              className="h-full bg-[#4176e6]"
              style={{ width: `${(convTokens / windowSize) * 100}%` }}
              title="对话消息"
            />
          </div>
          <StatRows
            rows={[
              { label: '系统提示词', value: `~${fmtTokens(sysTokens)}` },
              { label: '对话消息', value: `~${fmtTokens(convTokens)}` },
            ]}
          />
          <p className="mt-2.5 text-[11px] leading-4 text-stone-400">
            分段为示意估算（API 不返回上下文拆分）；总量以最近一轮 prompt_tokens 为准。
          </p>
        </DialogPill>
      )}
    </div>
  );
}

/** 助手消息行「用量」胶囊：点击查看本轮明细（dsh TurnUsagePanel） */
function TurnUsageButton({ usage, model }: { usage: UsageInfo; model: string | undefined }) {
  const hit =
    usage.cachedTokens != null ? cacheHitPct(usage.cachedTokens, usage.promptTokens) : null;
  return (
    <DialogPill
      variant="ghost"
      icon={<DatabaseIcon className="w-3.5 h-3.5" />}
      label={<>用量 {fmtTokens(usage.totalTokens)} tok</>}
      ariaLabel="本轮用量"
      title="本轮用量"
      titleValue={fmtExactTokens(usage.totalTokens)}
    >
      <StatRows
        rows={[
          { label: '提供方 / 模型', value: model ?? '—', hide: !model },
          { label: '缓存命中', value: hit != null ? `${fmtPct(hit)}%` : '—', hide: hit == null },
          { label: '未缓存输入', value: fmtExactTokens(uncachedOf(usage)) },
          {
            label: '缓存读取',
            value: fmtExactTokens(usage.cachedTokens ?? 0),
            hide: usage.cachedTokens == null,
          },
          {
            label: '缓存写入',
            value: fmtExactTokens(usage.cacheWriteTokens ?? 0),
            hide: !(usage.cacheWriteTokens && usage.cacheWriteTokens > 0),
          },
          { label: '输出', value: fmtExactTokens(usage.completionTokens) },
        ]}
      />
    </DialogPill>
  );
}

/**
 * 模型 + 推理等级合并菜单（dsh composer 右侧形态）：
 * 一级两行「模型 / 推理等级」；打开时主动 GET /models 刷新列表，避免只显示当前一项。
 */
function ModelEffortMenu({ settings }: { settings: LLMSettings | null }) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<'model' | 'effort' | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [modelsStatus, setModelsStatus] = useState<'idle' | 'loading' | 'ok' | 'fail'>('idle');
  const rootRef = useRef<HTMLDivElement>(null);
  const fetchSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setSub(null);
    };
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 菜单打开即拉取 / 刷新可用模型（缓存命中时先展示缓存，后台再校验）
  useEffect(() => {
    if (!open || !settings) return;
    const cached = settings.availableModels?.length ? settings.availableModels : [settings.model];
    setModels(cached);
    setModelsStatus(settings.availableModels?.length ? 'ok' : 'loading');
    const seq = ++fetchSeq.current;
    fetchModels(settings.baseURL, settings.apiKey)
      .then((ids) => {
        if (seq !== fetchSeq.current) return;
        const list = ids.length ? ids : [settings.model];
        setModels(list);
        setModelsStatus('ok');
        // 写回 localStorage，供下次打开与设置页共用
        if (ids.length) patchSettings({ availableModels: ids });
      })
      .catch(() => {
        if (seq !== fetchSeq.current) return;
        setModelsStatus(cached.length > 1 ? 'ok' : 'fail');
      });
  }, [open, settings]);

  if (!settings) {
    return (
      <button
        type="button"
        onClick={() => openSettings('model')}
        className="flex items-center gap-1 h-7 pl-2 pr-1 text-[13px] leading-5 font-medium text-stone-500 rounded-md hover:bg-stone-100 transition-colors"
      >
        配置模型
        <ChevronIcon className="w-3.5 h-3.5 text-stone-400" />
      </button>
    );
  }

  const effort = settings.reasoningEffort ?? 'high';
  const effortLabel = EFFORT_OPTIONS.find((o) => o.value === effort)?.label ?? 'High';

  function pick(patch: Partial<LLMSettings>) {
    patchSettings(patch);
    setOpen(false);
    setSub(null);
  }

  const rowCls = (active: boolean) =>
    `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left text-[13px] transition-colors ${
      active ? 'bg-stone-100' : 'hover:bg-stone-100'
    }`;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setSub(null);
        }}
        className={`flex items-center gap-1 h-7 pl-2 pr-1 text-[13px] leading-5 font-medium rounded-md transition-colors ${
          open ? 'bg-stone-100' : 'hover:bg-stone-100'
        }`}
      >
        <span className="max-w-40 truncate text-stone-600">{settings.model}</span>
        <span className="text-stone-400">{effortLabel}</span>
        <ChevronIcon
          className={`w-3.5 h-3.5 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="tw-popover absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-stone-200 p-1 shadow-xl z-50">
          <button
            type="button"
            onMouseEnter={() => setSub('model')}
            onClick={() => setSub('model')}
            className={rowCls(sub === 'model')}
          >
            <span className="text-stone-700">模型</span>
            <span className="ml-auto max-w-32 truncate text-stone-400">{settings.model}</span>
            <ChevronRightIcon className="w-3.5 h-3.5 text-stone-400" />
          </button>
          <button
            type="button"
            onMouseEnter={() => setSub('effort')}
            onClick={() => setSub('effort')}
            className={rowCls(sub === 'effort')}
          >
            <span className="text-stone-700">推理等级</span>
            <span className="ml-auto text-stone-400">{effortLabel}</span>
            <ChevronRightIcon className="w-3.5 h-3.5 text-stone-400" />
          </button>

          {sub === 'model' && (
            <div className="tw-popover absolute right-full bottom-0 mr-1.5 w-64 max-h-72 overflow-y-auto rounded-xl border border-stone-200 p-1 shadow-xl">
              {modelsStatus === 'loading' && models.length <= 1 && (
                <div className="px-3 py-2 text-xs text-stone-400">正在识别可用模型…</div>
              )}
              {models.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => pick({ model: id })}
                  className={rowCls(false)}
                >
                  <span
                    className={`flex-1 truncate ${id === settings.model ? 'text-stone-900 font-medium' : 'text-stone-600'}`}
                  >
                    {id}
                  </span>
                  {id === settings.model && <CheckIcon className="w-3.5 h-3.5 text-[#4176e6]" />}
                </button>
              ))}
              <div className="mt-1 border-t border-stone-100 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setSub(null);
                    openSettings('model');
                  }}
                  className="w-full px-3 py-1.5 rounded-lg text-left text-xs text-stone-400 hover:bg-stone-100"
                >
                  {modelsStatus === 'fail'
                    ? '识别失败，打开设置检查…'
                    : models.length > 1
                      ? '打开设置 · 模型…'
                      : '打开设置识别可用模型…'}
                </button>
              </div>
            </div>
          )}

          {sub === 'effort' && (
            <div className="tw-popover absolute right-full bottom-0 mr-1.5 w-60 rounded-xl border border-stone-200 p-1 shadow-xl">
              {EFFORT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => pick({ reasoningEffort: o.value })}
                  className="w-full px-3 py-2 rounded-lg text-left hover:bg-stone-100 transition-colors"
                >
                  <div className="flex items-center gap-2 text-[13px]">
                    <span
                      className={`flex-1 ${effort === o.value ? 'text-stone-900 font-medium' : 'text-stone-600'}`}
                    >
                      {o.label}
                    </span>
                    {effort === o.value && <CheckIcon className="w-3.5 h-3.5 text-[#4176e6]" />}
                  </div>
                  <div className="mt-0.5 text-xs text-stone-400">{o.desc}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatApp({ slashDocs = [] }: { slashDocs?: SlashDoc[] }) {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [store, setStore] = useState<SessionStore | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [images, setImages] = useState<ImageAtt[]>([]);
  const [docRefs, setDocRefs] = useState<DocRef[]>([]);
  const [systemPrompt, setSystemPrompt] = useState(FALLBACK_SYSTEM_PROMPT);
  const [caseGenPanelOpen, setCaseGenPanelOpen] = useState(false);
  const [caseGenConfig, setCaseGenConfig] = useState<CaseGenPluginConfig | null>(null);
  const caseGenConfigRef = useRef<CaseGenPluginConfig | null>(null);
  caseGenConfigRef.current = caseGenConfig;
  const [promptGenPanelOpen, setPromptGenPanelOpen] = useState(false);
  const [promptGenConfig, setPromptGenConfig] = useState<PromptGenPluginConfig | null>(null);
  const promptGenConfigRef = useRef<PromptGenPluginConfig | null>(null);
  promptGenConfigRef.current = promptGenConfig;
  const [knowledgeGenPanelOpen, setKnowledgeGenPanelOpen] = useState(false);
  const [knowledgeGenConfig, setKnowledgeGenConfig] = useState<KnowledgeGenPluginConfig | null>(
    null,
  );
  const knowledgeGenConfigRef = useRef<KnowledgeGenPluginConfig | null>(null);
  knowledgeGenConfigRef.current = knowledgeGenConfig;
  /** 从管理页「在会话中打开」带入：`root:path`，用于滚动定位到对应文件卡 */
  const [pendingFocusDoc, setPendingFocusDoc] = useState<string | null>(null);
  const [pluginIndex, setPluginIndex] = useState(0);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [deleteSessionId, setDeleteSessionId] = useState<string | null>(null);
  /** 软删除确认；已删除分类里再删则为永久删除 */
  const [purgeSessionId, setPurgeSessionId] = useState<string | null>(null);
  const [wsMenuId, setWsMenuId] = useState<string | null>(null);
  const [wsDeleteTarget, setWsDeleteTarget] = useState<WorkspaceItem | null>(null);
  const [wsRenameId, setWsRenameId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessLevel>('readonly');
  const [showJump, setShowJump] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  /** 插件开关（localStorage） */
  const [pluginOn, setPluginOn] = useState<Record<PluginId, boolean>>(() => loadPluginEnabled());
  /** 本地记忆中间件是否可用（仅 npm run dev） */
  const [memoryHealth, setMemoryHealth] = useState<MemoryHealth | null>(null);
  /** 本地工作区文件 Runner（仅 npm run dev） */
  const [fsHealth, setFsHealth] = useState<FsHealth | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [wsBusy, setWsBusy] = useState(false);
  /** 工作区树：展开的文件夹 path、搜索、添加输入框 */
  const [wsExpanded, setWsExpanded] = useState<Record<string, boolean>>({});
  const [wsQuery, setWsQuery] = useState('');
  const [wsSearchOpen, setWsSearchOpen] = useState(false);
  /** 会话行「…」菜单当前打开的 session id */
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
  /** 右侧主区：对话工作台 | 我的插件 */
  const [mainPane, setMainPane] = useState<'chat' | 'plugins'>('chat');
  /** 对话工作台内 Tab：对话 | 记忆（对齐 MemOS 查看入口） */
  const [chatTab, setChatTab] = useState<'dialog' | 'memory'>('dialog');
  const [generalPrefs, setGeneralPrefs] = useState<GeneralPrefs>(() =>
    typeof window === 'undefined'
      ? {
          language: 'zh-CN',
          appearance: 'system',
          sessionFontSize: 14,
          toolStepDetail: 'standard',
          busySendBehavior: 'queue',
        }
      : loadGeneralPrefs(),
  );
  const [toolBusy, setToolBusy] = useState(false);
  const [toolHint, setToolHint] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  /** 点击别处后暂时隐藏 @ / 插件菜单（输入变化后恢复） */
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [pluginMenuDismissed, setPluginMenuDismissed] = useState(false);
  /** 繁忙时排队发送的条数（展示用） */
  const [queueLen, setQueueLen] = useState(0);
  /** 「@」工作区文件缓存 */
  const [wsAtEntries, setWsAtEntries] = useState<WorkspaceFlatEntry[]>([]);
  const memoryLive = Boolean(pluginOn.memory && memoryHealth?.ok);
  const knowledgeOn = Boolean(pluginOn.knowledge);
  const fsLive = Boolean(fsHealth?.ok);
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  type PendingSend = {
    content: string;
    files: Attachment[];
    refs: DocRef[];
    imgs: ImageAtt[];
  };
  const sendQueueRef = useRef<PendingSend[]>([]);
  const interruptPayloadRef = useRef<PendingSend | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const pluginMenuRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  /** 各会话输入草稿（切换会话时保留） */
  const composerDraftsRef = useRef<
    Record<
      string,
      { input: string; attachments: Attachment[]; images: ImageAtt[]; docRefs: DocRef[] }
    >
  >({});
  const base = import.meta.env.BASE_URL || '/';

  const hasWorkspace = Boolean(fsLive && workspaceInfo?.workspace);
  const atState = getAtMentionState(input);
  const atProjectDocs = (() => {
    if (!atState || !knowledgeOn) return [] as SlashDoc[];
    const q = atState.query.toLowerCase();
    const list = !q ? slashDocs : slashDocs.filter((d) => matchSlashQuery(d, q));
    return list.slice(0, 10);
  })();
  const atWorkspaceDocs = (() => {
    if (!atState || !hasWorkspace) return [] as SlashDoc[];
    const q = atState.query.toLowerCase();
    const mapped: SlashDoc[] = wsAtEntries.map((e) => ({
      collection: 'workspace' as const,
      id: `ws:${e.path}`,
      title: e.name,
      category: shortWorkspaceLabel(workspaceInfo?.workspace),
      description: e.path,
      format: e.type === 'dir' ? 'dir' : 'file',
      path: e.path,
    }));
    const list = !q
      ? mapped
      : mapped.filter(
          (d) =>
            matchSlashQuery(d, q) ||
            d.path.toLowerCase().includes(q) ||
            d.title.toLowerCase().includes(q),
        );
    return list.slice(0, 10);
  })();
  /** 扁平列表供键盘上下键；带 section 标记供渲染分割线 */
  const atFlatItems = [
    ...atProjectDocs.map((d) => ({ section: 'project' as const, doc: d })),
    ...atWorkspaceDocs.map((d) => ({ section: 'workspace' as const, doc: d })),
  ];
  const atOpen = Boolean(atState && !mentionDismissed && (knowledgeOn || hasWorkspace));

  const pluginSlashState = getPluginSlashState(input);
  const pluginMenuItems = PLUGIN_CATALOG.filter((p) => p.hasPanel);
  const pluginMenuOpen = Boolean(
    pluginSlashState && !pluginMenuDismissed && !atOpen && pluginMenuItems.length > 0,
  );
  /** 滚动跟随意图（dsh ScrollFollow 核心）：仅贴底时跟随新内容，用户上滚即脱离 */
  const followRef = useRef(true);
  /** 「回到底部」平滑滚动进行中：动画途中的滚动事件不改变跟随意图 */
  const jumpingRef = useRef(false);
  /** 会话库最新快照：写回消息时避免闭包过期 */
  const storeRef = useRef<SessionStore | null>(null);
  const messagesRef = useRef<LocalMessage[]>([]);
  messagesRef.current = messages;

  function commitStore(next: SessionStore) {
    storeRef.current = next;
    setStore(next);
    saveSessionStore(next);
  }

  useEffect(() => {
    let cancelled = false;
    const offSettings = onSettingsChanged(() => setSettings(loadSettings()));
    const offPlugins = onPluginEnabledChanged((map) => setPluginOn(map));
    const offAccess = onAccessLevelChanged((level) => setAccess(level));
    const offGeneral = onGeneralPrefsChanged((p) => {
      setGeneralPrefs(p);
      applyGeneralPrefs(p);
    });

    void (async () => {
      await hydrateAppConfig();
      if (cancelled) return;
      const g = loadGeneralPrefs();
      setGeneralPrefs(g);
      applyGeneralPrefs(g);
      setSettings(loadSettings());
      setAccess(loadAccessLevel());
      setPluginOn(loadPluginEnabled());
      setRailOpen(loadRailOpen());

      const loaded = await hydrateSessionStore();
      if (cancelled) return;
      let store = loaded;
      const params = new URLSearchParams(window.location.search);
      const sid = params.get('session');
      const focusRoot = params.get('focusRoot');
      const focusPathRaw = params.get('focusPath');
      let focusKey: string | null = null;
      if (focusRoot && focusPathRaw) {
        try {
          const path = decodeURIComponent(focusPathRaw).replace(/\\/g, '/').replace(/^\/+/, '');
          focusKey = `${focusRoot}:${path}`;
        } catch {
          focusKey = `${focusRoot}:${focusPathRaw}`;
        }
      }
      if (sid && store.sessions.some((s) => s.id === sid)) {
        store = switchSession(store, sid);
        saveSessionStore(store);
      }
      if (focusKey) setPendingFocusDoc(focusKey);
      // 清掉 query，避免刷新反复切会话 / 重复滚动
      try {
        const u = new URL(window.location.href);
        u.searchParams.delete('session');
        u.searchParams.delete('focusRoot');
        u.searchParams.delete('focusPath');
        window.history.replaceState({}, '', u.pathname + u.search + u.hash);
      } catch {
        // ignore
      }
      storeRef.current = store;
      setStore(store);
      const active = store.sessions.find((s) => s.id === store.activeId);
      setMessages((active?.messages as LocalMessage[]) ?? []);
      setCaseGenConfig(active?.caseGen?.active ? active.caseGen : null);
      setPromptGenConfig(active?.promptGen?.active ? active.promptGen : null);
      setKnowledgeGenConfig(active?.knowledgeGen?.active ? active.knowledgeGen : null);
      if (active?.workspacePath) {
        setWsExpanded((prev) => ({ ...prev, [active.workspacePath!]: true }));
      } else if (active) {
        setWsExpanded((prev) => ({ ...prev, __ungrouped__: true }));
      }
      setMainPane('chat');
      setChatTab('dialog');
      setReady(true);

      try {
        const u = new URL(window.location.href);
        const pluginQ = u.searchParams.get('plugin');
        if (pluginQ === 'promptGen' || pluginQ === 'knowledgeGen' || pluginQ === 'caseGen') {
          const id = pluginQ as PluginId;
          setMainPane('chat');
          if (loadPluginEnabled()[id]) {
            if (id === 'promptGen') setPromptGenPanelOpen(true);
            else if (id === 'knowledgeGen') setKnowledgeGenPanelOpen(true);
            else setCaseGenPanelOpen(true);
          } else {
            setError(pluginDisabledMessage(id));
          }
          u.searchParams.delete('plugin');
          window.history.replaceState({}, '', u.pathname + u.search + u.hash);
        }
      } catch {
        // ignore
      }

      void (async () => {
        try {
          if (!(await fetchDocsHealth('prompts'))) return;
          const r = await readDocsText('prompts', CHAT_SYSTEM_PROMPT_FILE);
          const text = r.content.trim();
          if (text) setSystemPrompt(text);
        } catch {
          // 回退 FALLBACK_SYSTEM_PROMPT
        }
      })();
      void fetchMemoryHealth().then((m) => setMemoryHealth(m));
      void fetchFsHealth().then((h) => setFsHealth(h));
      void fetchWorkspace().then((w) => {
        setWorkspaceInfo(w);
        if (w?.workspace) {
          setWsExpanded((prev) => ({ ...prev, [w.workspace]: true }));
        }
      });
    })();

    return () => {
      cancelled = true;
      offSettings();
      offPlugins();
      offAccess();
      offGeneral();
    };
  }, []);

  /** 记忆插件关闭后隐藏入口，并退出记忆页 */
  useEffect(() => {
    if (!pluginOn.memory && chatTab === 'memory') setChatTab('dialog');
  }, [pluginOn.memory, chatTab]);

  /** Shift：取消非输入框聚焦（去掉会话行蓝框等） */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Shift' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (!(el instanceof HTMLElement) || el === document.body) return;
      if (
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'INPUT' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      ) {
        return;
      }
      el.blur();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    setMentionIndex(0);
    setMentionDismissed(false);
  }, [atState?.query, atState?.from]);

  useEffect(() => {
    setPluginMenuDismissed(false);
    setPluginIndex(0);
  }, [pluginSlashState?.from]);

  useEffect(() => {
    setPluginIndex((i) => (pluginMenuItems.length ? Math.min(i, pluginMenuItems.length - 1) : 0));
  }, [pluginMenuItems.length]);

  /** 「@」打开时拉取工作区浅层列表 */
  useEffect(() => {
    if (!atOpen || !hasWorkspace) {
      if (!hasWorkspace) setWsAtEntries([]);
      return;
    }
    let cancelled = false;
    void listWorkspaceFlat(access, { maxDepth: 3, maxEntries: 80 }).then((list) => {
      if (!cancelled) setWsAtEntries(list);
    });
    return () => {
      cancelled = true;
    };
  }, [atOpen, hasWorkspace, access, workspaceInfo?.workspace]);

  /** 键盘选中项滚入 @ 弹窗可视区 */
  useEffect(() => {
    if (!atOpen) return;
    const root = mentionListRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-mention-index="${mentionIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [mentionIndex, atOpen, atFlatItems.length]);

  useEffect(() => {
    if (!pluginMenuOpen) return;
    const root = pluginMenuRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-plugin-index="${pluginIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [pluginIndex, pluginMenuOpen, pluginMenuItems.length]);

  /** 点击检索列表与输入框以外：关闭 @ / 插件浮层 */
  useEffect(() => {
    if (!atOpen && !pluginMenuOpen) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (mentionListRef.current?.contains(t)) return;
      if (pluginMenuRef.current?.contains(t)) return;
      if (textareaRef.current?.contains(t)) return;
      setMentionDismissed(true);
      setPluginMenuDismissed(true);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [atOpen, pluginMenuOpen]);

  /** 点击会话/工作区菜单以外：关闭「…」菜单 */
  useEffect(() => {
    if (!sessionMenuId && !wsMenuId) return;
    function onPointerDown(e: PointerEvent) {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('[data-session-menu]')) return;
      if (el?.closest?.('[data-ws-menu]')) return;
      setSessionMenuId(null);
      setWsMenuId(null);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [sessionMenuId, wsMenuId]);

  function refreshPluginRuntime() {
    void fetchMemoryHealth().then((m) => setMemoryHealth(m));
    void fetchFsHealth().then((h) => setFsHealth(h));
    void fetchWorkspace().then((w) => setWorkspaceInfo(w));
  }

  function syncWorkspaceInfo(info: WorkspaceInfo) {
    setWorkspaceInfo(info);
    setWsExpanded((prev) => ({ ...prev, [info.workspace]: true }));
  }

  async function applyWorkspace(path: string, mode: 'select' | 'add' = 'select') {
    if (!fsLive || wsBusy) return;
    setWsBusy(true);
    setError(null);
    try {
      const info = mode === 'add' ? await addWorkspace(path) : await selectWorkspace(path);
      syncWorkspaceInfo(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWsBusy(false);
    }
  }

  /** dsh：原生选文件夹 → create workspace */
  async function addWorkspaceByPicker() {
    if (!fsLive || wsBusy) return;
    setWsBusy(true);
    setError(null);
    try {
      const path = await pickDirectory();
      if (!path) return;
      const info = await addWorkspace(path);
      syncWorkspaceInfo(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWsBusy(false);
    }
  }

  async function confirmDropWorkspace() {
    const item = wsDeleteTarget;
    if (!item || !fsLive || wsBusy) return;
    if (item.id === 'ws_project') {
      setWsDeleteTarget(null);
      return;
    }
    setWsDeleteTarget(null);
    setWsMenuId(null);
    setWsBusy(true);
    setError(null);
    try {
      if (storeRef.current) {
        commitStore(unbindSessionsFromWorkspace(storeRef.current, item.path));
      }
      const info = await removeWorkspace(item.id);
      syncWorkspaceInfo(info);
      setWsExpanded((prev) => ({ ...prev, [UNGROUPED_KEY]: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWsBusy(false);
    }
  }

  function requestDropWorkspace(item: WorkspaceItem) {
    if (!fsLive || wsBusy || item.id === 'ws_project') return;
    setWsMenuId(null);
    setWsDeleteTarget(item);
  }

  async function confirmRenameWorkspace(name: string) {
    const id = wsRenameId;
    setWsRenameId(null);
    if (!id || !fsLive) return;
    setWsBusy(true);
    setError(null);
    try {
      const info = await renameWorkspace(id, name);
      syncWorkspaceInfo(info);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWsBusy(false);
    }
  }

  /** 离开空「新对话」时丢弃，不进已删除 */
  function pruneEphemeralSession(id: string | undefined | null): SessionStore | null {
    if (!id || !storeRef.current) return storeRef.current;
    const s = storeRef.current.sessions.find((x) => x.id === id);
    if (!s || !isEphemeralEmptySession(s)) return storeRef.current;
    delete composerDraftsRef.current[id];
    const next = deleteSession(storeRef.current, id);
    return next;
  }

  function pickAtDoc(doc: SlashDoc) {
    if (!atState) return;
    if (doc.collection !== 'workspace' && !knowledgeOn) {
      setError(pluginDisabledMessage('knowledge'));
      return;
    }
    if (docRefs.length >= REF_MAX_COUNT) {
      setError(`最多引用 ${REF_MAX_COUNT} 篇文档`);
      return;
    }
    setError(null);
    setDocRefs((prev) => {
      if (prev.some((r) => r.collection === doc.collection && r.path === doc.path)) return prev;
      return [
        ...prev,
        {
          collection: doc.collection,
          id: doc.id,
          title: doc.title,
          category: doc.category,
          path: doc.path,
          format: doc.format,
        },
      ].slice(0, REF_MAX_COUNT);
    });
    setInput(input.slice(0, atState.from).replace(/\s+$/, ''));
    setMentionDismissed(true);
    textareaRef.current?.focus();
  }

  function clearPluginSlashTrigger() {
    if (!pluginSlashState) return;
    setInput(input.slice(0, pluginSlashState.from).replace(/\s+$/, ''));
    setPluginMenuDismissed(true);
  }

  function openPluginPanel(id: PluginId): boolean {
    if (!pluginOn[id]) {
      setError(pluginDisabledMessage(id));
      return false;
    }
    setError(null);
    setMainPane('chat');
    if (id === 'caseGen') {
      setCaseGenPanelOpen(true);
      return true;
    }
    if (id === 'promptGen') {
      setPromptGenPanelOpen(true);
      return true;
    }
    if (id === 'knowledgeGen') {
      setKnowledgeGenPanelOpen(true);
      return true;
    }
    if (id === 'memory') {
      setChatTab('memory');
      return true;
    }
    return false;
  }

  function pickPluginMenu(id: PluginId) {
    clearPluginSlashTrigger();
    openPluginPanel(id);
  }

  /** 滚动采样：距底 48px 内视为贴底（dsh nearBottom 阈值策略） */
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.clientHeight - el.scrollTop <= 48;
    if (jumpingRef.current) {
      if (!near) return;
      jumpingRef.current = false;
    }
    followRef.current = near;
    setShowJump(!near);
  }

  function jumpToBottom() {
    const el = scrollRef.current;
    if (!el) return;
    followRef.current = true;
    jumpingRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }

  useEffect(() => {
    if (!ready || !storeRef.current) return;
    const next = updateActiveMessages(storeRef.current, messages);
    storeRef.current = next;
    setStore(next);
    saveSessionStore(next);
    // 跟随态才自动滚底；用户上滚阅读历史时不打扰
    if (followRef.current && !jumpingRef.current) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [messages, ready]);

  // 输入框随内容自动长高（上限 200px，超出内部滚动）
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  // 管理页「在会话中打开」：滚到对应入库文件卡并短暂高亮
  useEffect(() => {
    if (!ready || !pendingFocusDoc || !messages.length) return;
    const key = pendingFocusDoc;
    const t = window.setTimeout(() => {
      const root = scrollRef.current ?? document;
      const el = root.querySelector(`[data-focus-doc="${CSS.escape(key)}"]`);
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-[#4176e6]', 'ring-offset-2');
        window.setTimeout(() => {
          el.classList.remove('ring-2', 'ring-[#4176e6]', 'ring-offset-2');
        }, 2400);
      }
      setPendingFocusDoc(null);
    }, 80);
    return () => window.clearTimeout(t);
  }, [ready, pendingFocusDoc, messages]);

  function updateLastAssistant(fn: (m: LocalMessage) => LocalMessage) {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role !== 'assistant') return prev;
      const copy = prev.slice();
      copy[copy.length - 1] = fn(last);
      return copy;
    });
  }

  async function addImages(files: File[]) {
    if (!files.length) return;
    const accepted: ImageAtt[] = [];
    const rejected: string[] = [];
    let used = composerFileCount(attachments, images);
    for (const f of files) {
      if (used + accepted.length >= FILE_MAX_COUNT) {
        rejected.push(`${f.name || '图片'}（最多 ${FILE_MAX_COUNT} 个文件）`);
        continue;
      }
      try {
        accepted.push(await fileToImageAtt(f));
      } catch (e) {
        rejected.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (accepted.length) {
      setImages((prev) => [...prev, ...accepted].slice(0, FILE_MAX_COUNT));
    }
    setError(rejected.length ? `以下图片未添加：${rejected.join('、')}` : null);
  }

  function clearComposer() {
    setInput('');
    setAttachments([]);
    setImages([]);
    setDocRefs([]);
    setMentionDismissed(false);
    setPluginMenuDismissed(false);
  }

  async function send(text?: string, opts?: { forceBusy?: BusySendBehavior }) {
    const fromComposer = text === undefined;
    const content = (text ?? input).trim();
    const files = fromComposer ? attachments : [];
    const refs = fromComposer ? docRefs : [];
    const imgs = fromComposer ? images : [];
    if (!content && !files.length && !refs.length && !imgs.length) return;
    if (!settings) {
      openSettings('model');
      return;
    }

    const prepared: PendingSend = {
      content,
      files: [...files],
      refs: [...refs],
      imgs: [...imgs],
    };

    if (streamingRef.current) {
      const primary = loadGeneralPrefs().busySendBehavior ?? 'queue';
      const action = opts?.forceBusy ?? primary;
      if (action === 'queue') {
        sendQueueRef.current.push(prepared);
        setQueueLen(sendQueueRef.current.length);
        if (fromComposer) clearComposer();
        return;
      }
      // 插话：中断当前轮，结束后立刻发这条
      interruptPayloadRef.current = prepared;
      if (fromComposer) clearComposer();
      abortRef.current?.abort();
      return;
    }

    await executeSend(prepared);
  }

  async function executeSend(prepared: PendingSend) {
    if (!settings || streamingRef.current) return;
    const { content, files, refs, imgs } = prepared;
    setError(null);
    const now = Date.now();
    const userMsg: LocalMessage = { role: 'user', content, time: now };
    if (files.length) userMsg.attachments = files;
    if (refs.length) userMsg.refs = refs;
    if (imgs.length) userMsg.images = imgs;
    // 同步裁掉「中断后仍为空」的助手气泡，避免排队/插话叠一条空消息
    // 注意：勿命名为 base，会遮蔽外层 BASE_URL，导致 kb_* 工具 opts.base.endsWith 报错
    let hist = messagesRef.current;
    const last = hist[hist.length - 1];
    if (last?.role === 'assistant' && !last.content && !last.reasoning) {
      hist = hist.slice(0, -1);
    }
    const next: LocalMessage[] = [...hist, userMsg];
    const withAssistant: LocalMessage[] = [...next, { role: 'assistant', content: '', time: now }];
    messagesRef.current = withAssistant;
    setMessages(withAssistant);
    clearComposer();
    streamingRef.current = true;
    setStreaming(true);
    followRef.current = true; // 发送新消息：强制回到跟随态
    setShowJump(false);

    // role+content；有图时 content 为多模态数组；助手思考内容须按 DeepSeek 要求回传
    const apiMessages: ChatMessage[] = next.map((m) => {
      const msg: ChatMessage = {
        role: m.role,
        content: toApiMessageContent(m),
      };
      if (m.role === 'assistant' && m.reasoning?.trim()) {
        msg.reasoning_content = m.reasoning;
      }
      return msg;
    });
    const useMemory = memoryLive;
    const useKnowledge = knowledgeOn;
    const useFs = fsLive;
    const fsHintExtra = workspaceInfo?.workspace ? `\n当前工作区：${workspaceInfo.workspace}` : '';
    const promptCfg =
      pluginOn.promptGen && promptGenConfigRef.current?.active ? promptGenConfigRef.current : null;
    const knowledgeGenCfg =
      !promptCfg && pluginOn.knowledgeGen && knowledgeGenConfigRef.current?.active
        ? knowledgeGenConfigRef.current
        : null;
    const caseCfg =
      !promptCfg && !knowledgeGenCfg && pluginOn.caseGen && caseGenConfigRef.current?.active
        ? caseGenConfigRef.current
        : null;
    const structuredPlugin = Boolean(promptCfg || knowledgeGenCfg || caseCfg);
    const memCwd =
      storeRef.current?.sessions.find((s) => s.id === storeRef.current?.activeId)?.workspacePath ||
      workspaceInfo?.workspace ||
      '';
    let baseSystem = systemPrompt;
    if (promptCfg) {
      baseSystem = buildPromptGenSystemPrompt(promptCfg);
    } else if (knowledgeGenCfg) {
      baseSystem = buildKnowledgeGenSystemPrompt(knowledgeGenCfg);
    } else if (caseCfg) {
      if (!caseCfg.promptBody?.trim()) {
        setError('生成测试用例已启用，但未选择提示词。请打开插件重新「确认使用」。');
        streamingRef.current = false;
        setStreaming(false);
        setMessages((prev) =>
          prev[prev.length - 1]?.role === 'assistant' && !prev[prev.length - 1]?.content
            ? prev.slice(0, -1)
            : prev,
        );
        return;
      }
      try {
        baseSystem = buildCaseGenSystemPrompt(
          caseCfg,
          caseCfg.reqPath
            ?.split('/')
            .pop()
            ?.replace(/\.[^.]+$/, '') || '',
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        streamingRef.current = false;
        setStreaming(false);
        return;
      }
    }
    let payload = buildPluginMessages(baseSystem, apiMessages, {
      memory: useMemory && !structuredPlugin,
      knowledge: useKnowledge && !structuredPlugin,
      fs: useFs && !structuredPlugin,
    }).map((m, i) =>
      i === 0 && m.role === 'system' && useFs && fsHintExtra && !structuredPlugin
        ? { ...m, content: `${typeof m.content === 'string' ? m.content : ''}${fsHintExtra}` }
        : m,
    );

    // 五轨快照注入：超时/失败则跳过，不阻塞发送（结构化插件模式跳过）
    if (useMemory && !structuredPlugin) {
      setToolHint('记忆注入中…');
      const { context } = await recallMemory(content, { cwd: memCwd });
      if (context && payload[0]?.role === 'system') {
        const sys = typeof payload[0].content === 'string' ? payload[0].content : '';
        payload = [{ ...payload[0], content: `${sys}\n\n${context}` }, ...payload.slice(1)];
      }
      setToolHint(null);
    }

    const tools: ToolDef[] = [];
    if (!structuredPlugin) {
      if (useKnowledge) tools.push(...(KB_TOOLS as unknown as ToolDef[]));
      if (useFs) tools.push(...(fsToolsForAccess(access) as unknown as ToolDef[]));
      if (useMemory) tools.push(...(MEMORY_TOOLS as unknown as ToolDef[]));
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const requestStartTs = Date.now();
    let firstTokenTs = 0;
    let reasoningStartTs = 0;
    let reasoningSettled = false;
    let turnOk = false;
    let progressTimer: number | undefined;
    const structuredGen = Boolean(promptCfg || knowledgeGenCfg || caseCfg);
    function structuredProgress(elapsedSec: number) {
      if (promptCfg) return formatPromptGenProgress(elapsedSec);
      if (knowledgeGenCfg) return formatKnowledgeGenProgress(elapsedSec);
      return formatCaseGenProgress(elapsedSec);
    }
    function structuredToolHint() {
      if (promptCfg) return '正在编写提示词…';
      if (knowledgeGenCfg) return '正在编写知识库…';
      return '正在编写用例…';
    }
    try {
      let caseRaw = '';
      let promptRaw = '';
      let knowledgeGenRaw = '';
      if (structuredGen) {
        setToolHint(structuredToolHint());
        const paint = () => {
          const elapsed = Math.max(0, Math.floor((Date.now() - requestStartTs) / 1000));
          updateLastAssistant((m) => ({ ...m, content: structuredProgress(elapsed) }));
        };
        paint();
        progressTimer = window.setInterval(paint, 1000);
      }
      const stream = streamChatWithTools(settings, payload, ctrl.signal, {
        tools: tools.length ? tools : undefined,
        runTool: tools.length
          ? async (name, args) => {
              setToolBusy(true);
              const kind = toolKindLabel(name);
              setToolHint(toolStepHint(loadGeneralPrefs().toolStepDetail, kind, name, 'running'));
              try {
                if (name.startsWith('kb_')) {
                  return await runKnowledgeTool(name, args, { base, docs: slashDocs });
                }
                if (name.startsWith('fs_')) return await runFsTool(name, args, access);
                if (name.startsWith('memory_')) return await runMemoryTool(name, args, memCwd);
                return JSON.stringify({ error: `unknown tool: ${name}` });
              } finally {
                setToolBusy(false);
                refreshPluginRuntime();
              }
            }
          : undefined,
      });
      for await (const chunk of stream) {
        if (chunk.type === 'tool') {
          const kind = toolKindLabel(chunk.name);
          setToolHint(
            toolStepHint(
              loadGeneralPrefs().toolStepDetail,
              kind,
              chunk.name,
              chunk.status === 'running' ? 'running' : 'done',
            ),
          );
          continue;
        }
        if (chunk.type === 'usage') {
          const nowTs = Date.now();
          const decodeSecs = firstTokenTs ? (nowTs - firstTokenTs) / 1000 : 0;
          const tps = decodeSecs > 0.2 ? chunk.usage.completionTokens / decodeSecs : undefined;
          updateLastAssistant((m) => ({
            ...m,
            usage: chunk.usage,
            tps,
            model: settings.model,
            ttftMs: firstTokenTs ? firstTokenTs - requestStartTs : m.ttftMs,
            llmMs: nowTs - requestStartTs,
          }));
          continue;
        }
        if (firstTokenTs === 0) {
          firstTokenTs = Date.now();
          updateLastAssistant((m) => ({
            ...m,
            ttftMs: firstTokenTs - requestStartTs,
            model: settings.model,
          }));
        }
        if (chunk.type === 'reasoning' && reasoningStartTs === 0) reasoningStartTs = Date.now();
        // 首个正文 chunk 到达 = 思考结束，结算耗时
        const settle = chunk.type === 'content' && reasoningStartTs > 0 && !reasoningSettled;
        if (settle) reasoningSettled = true;
        if (structuredGen) {
          if (chunk.type === 'content') {
            if (promptCfg) promptRaw += chunk.delta;
            else if (knowledgeGenCfg) knowledgeGenRaw += chunk.delta;
            else caseRaw += chunk.delta;
          }
          const elapsed = Math.max(0, Math.floor((Date.now() - requestStartTs) / 1000));
          const progress = structuredProgress(elapsed);
          if (chunk.type === 'reasoning') {
            updateLastAssistant((last) => {
              const nextMsg = {
                ...last,
                reasoning: (last.reasoning ?? '') + chunk.delta,
                content: progress,
              };
              if (settle) {
                nextMsg.reasoningDuration = Math.max(
                  1,
                  Math.round((Date.now() - reasoningStartTs) / 1000),
                );
              }
              return nextMsg;
            });
          } else if (settle) {
            updateLastAssistant((last) => ({
              ...last,
              content: progress,
              reasoningDuration: Math.max(1, Math.round((Date.now() - reasoningStartTs) / 1000)),
            }));
          }
          continue;
        }
        updateLastAssistant((last) => {
          const nextMsg =
            chunk.type === 'reasoning'
              ? { ...last, reasoning: (last.reasoning ?? '') + chunk.delta }
              : { ...last, content: last.content + chunk.delta };
          if (settle) {
            nextMsg.reasoningDuration = Math.max(
              1,
              Math.round((Date.now() - reasoningStartTs) / 1000),
            );
          }
          return nextMsg;
        });
      }
      turnOk = true;
      // 流正常结束但正文为空（罕见边界）：也结算思考耗时
      if (reasoningStartTs > 0 && !reasoningSettled) {
        const duration = Math.max(1, Math.round((Date.now() - reasoningStartTs) / 1000));
        updateLastAssistant((m) =>
          m.reasoning && m.reasoningDuration == null ? { ...m, reasoningDuration: duration } : m,
        );
      }
      if (progressTimer != null) {
        window.clearInterval(progressTimer);
        progressTimer = undefined;
      }
      if (promptCfg) {
        setToolHint('正在质检并入库…');
        const finished = await tryFinishPromptGenFromAssistant(promptRaw, promptCfg);
        updateLastAssistant((m) => ({
          ...m,
          content: finished.summary,
          docsFile: finished.ok
            ? {
                root: 'prompts',
                path: finished.path,
                name: finished.path.split('/').pop() || finished.title || finished.path,
              }
            : undefined,
        }));
        if (finished.ok && storeRef.current) {
          const nextCfg: PromptGenPluginConfig = {
            ...promptCfg,
            linkedPromptPath: finished.path,
          };
          setPromptGenConfig(nextCfg);
          promptGenConfigRef.current = nextCfg;
          commitStore(updateActiveSessionMeta(storeRef.current, { promptGen: nextCfg }));
        }
      } else if (knowledgeGenCfg) {
        setToolHint('正在质检并入库…');
        const finished = await tryFinishKnowledgeGenFromAssistant(knowledgeGenRaw, knowledgeGenCfg);
        updateLastAssistant((m) => ({
          ...m,
          content: finished.summary,
          docsFile: finished.ok
            ? {
                root: 'knowledge',
                path: finished.path,
                name: finished.path.split('/').pop() || finished.title || finished.path,
                note: finished.category,
              }
            : undefined,
        }));
        if (finished.ok && storeRef.current) {
          const nextCfg: KnowledgeGenPluginConfig = {
            ...knowledgeGenCfg,
            linkedKnowledgePath: finished.path,
          };
          setKnowledgeGenConfig(nextCfg);
          knowledgeGenConfigRef.current = nextCfg;
          commitStore(updateActiveSessionMeta(storeRef.current, { knowledgeGen: nextCfg }));
        }
      } else if (caseCfg) {
        setToolHint('正在检测覆盖并入库…');
        const hint =
          caseCfg.reqPath
            ?.split('/')
            .pop()
            ?.replace(/\.[^.]+$/, '') || content.slice(0, 24);
        const finished = await tryFinishCaseGenFromAssistant(caseRaw, caseCfg, hint);
        updateLastAssistant((m) => ({
          ...m,
          content: finished.summary,
          caseFile: finished.ok
            ? {
                path: finished.path,
                name: finished.path.split('/').pop() || finished.path,
                count: finished.count,
              }
            : undefined,
        }));
        if (finished.ok && storeRef.current) {
          const nextCfg: CaseGenPluginConfig = {
            ...caseCfg,
            linkedCasePath: finished.path,
          };
          setCaseGenConfig(nextCfg);
          caseGenConfigRef.current = nextCfg;
          commitStore(updateActiveSessionMeta(storeRef.current, { caseGen: nextCfg }));
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e));
      }
      // 移除未产生内容的空 assistant 消息
      setMessages((prev) =>
        prev[prev.length - 1]?.role === 'assistant' && prev[prev.length - 1]?.content === ''
          ? prev.slice(0, -1)
          : prev,
      );
    } finally {
      if (progressTimer != null) {
        window.clearInterval(progressTimer);
        progressTimer = undefined;
      }
      const nowTs = Date.now();
      updateLastAssistant((m) => ({
        ...m,
        time: nowTs,
        model: m.model ?? settings.model,
        llmMs: m.llmMs ?? nowTs - requestStartTs,
        ttftMs: m.ttftMs ?? (firstTokenTs ? firstTokenTs - requestStartTs : undefined),
      }));
      streamingRef.current = false;
      setStreaming(false);
      abortRef.current = null;
      {
        const detail = loadGeneralPrefs().toolStepDetail;
        // concise/standard：立即清；detailed 稍留；full 多留一会便于阅读
        if (detail === 'full') {
          window.setTimeout(() => setToolHint(null), 2800);
        } else if (detail === 'detailed') {
          window.setTimeout(() => setToolHint(null), 1200);
        } else {
          setToolHint(null);
        }
      }
      // 后台沉淀（不阻塞下一轮）；明确「记住」类话术才写入
      if (turnOk && useMemory) {
        void maybeCaptureMemory(content, memCwd).then((wrote) => {
          if (wrote) refreshPluginRuntime();
        });
      }

      // 插话优先，否则取排队队首
      const followUp = interruptPayloadRef.current ?? sendQueueRef.current.shift() ?? null;
      interruptPayloadRef.current = null;
      setQueueLen(sendQueueRef.current.length);
      if (followUp) {
        window.setTimeout(() => {
          void executeSend(followUp);
        }, 0);
      }
    }
  }

  function stop() {
    // 手动停止不触发插话/排队续发
    interruptPayloadRef.current = null;
    abortRef.current?.abort();
  }

  function toggleReasoning(index: number, e: ReactMouseEvent<HTMLButtonElement>) {
    const willOpen = !(messages[index]?.reasoningOpen ?? false);
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, reasoningOpen: !m.reasoningOpen } : m)),
    );
    if (willOpen) {
      // 展开后内容若落到视口外，平滑下滚刚好露全（block:nearest 已在视口内则不动）
      const btn = e.currentTarget;
      requestAnimationFrame(() => {
        const body = btn.nextElementSibling;
        (body ?? btn).scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
  }

  function saveComposerDraft(sessionId: string | undefined) {
    if (!sessionId) return;
    const hasContent =
      Boolean(input.trim()) || attachments.length > 0 || images.length > 0 || docRefs.length > 0;
    if (hasContent) {
      composerDraftsRef.current[sessionId] = {
        input,
        attachments,
        images,
        docRefs,
      };
    } else {
      delete composerDraftsRef.current[sessionId];
    }
  }

  function restoreComposerDraft(sessionId: string | undefined) {
    const d = sessionId ? composerDraftsRef.current[sessionId] : undefined;
    setInput(d?.input ?? '');
    setAttachments(d?.attachments ?? []);
    setImages(d?.images ?? []);
    setDocRefs(d?.docRefs ?? []);
  }

  function resetComposer(opts?: { clearDraft?: boolean }) {
    abortRef.current?.abort();
    setStreaming(false);
    setAttachments([]);
    setImages([]);
    setDocRefs([]);
    setInput('');
    setError(null);
    setShowJump(false);
    followRef.current = true;
    if (opts?.clearDraft && storeRef.current?.activeId) {
      delete composerDraftsRef.current[storeRef.current.activeId];
    }
  }

  function pluginSessionTitle(kind: 'caseGen' | 'promptGen' | 'knowledgeGen'): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    const label =
      kind === 'caseGen' ? '生成测试用例' : kind === 'promptGen' ? '生成提示词' : '生成知识库';
    return `${label} · ${stamp}`;
  }

  /** 确认启用插件时：新建会话（带 id），再挂插件配置，避免同一会话混多个生成任务 */
  function beginPluginSession(
    kind: 'caseGen' | 'promptGen' | 'knowledgeGen',
    cfg: CaseGenPluginConfig | PromptGenPluginConfig | KnowledgeGenPluginConfig,
  ) {
    if (!storeRef.current) return;
    setMainPane('chat');
    setChatTab('dialog');
    const leavingId = storeRef.current.activeId;
    saveComposerDraft(leavingId);
    resetComposer({ clearDraft: true });
    const base = pruneEphemeralSession(leavingId) ?? storeRef.current;
    // 插件开新会话默认进未分组；仅工作区旁「+」才指定归属
    let next = createSession(base);
    const title = pluginSessionTitle(kind);
    const activeId = next.activeId;
    next = {
      ...next,
      sessions: next.sessions.map((s) =>
        s.id === activeId
          ? {
              ...s,
              title,
              caseGen: kind === 'caseGen' ? (cfg as CaseGenPluginConfig) : undefined,
              promptGen: kind === 'promptGen' ? (cfg as PromptGenPluginConfig) : undefined,
              knowledgeGen: kind === 'knowledgeGen' ? (cfg as KnowledgeGenPluginConfig) : undefined,
              updatedAt: Date.now(),
            }
          : s,
      ),
    };
    commitStore(next);
    setMessages([]);
    setCaseGenConfig(kind === 'caseGen' ? (cfg as CaseGenPluginConfig) : null);
    caseGenConfigRef.current = kind === 'caseGen' ? (cfg as CaseGenPluginConfig) : null;
    setPromptGenConfig(kind === 'promptGen' ? (cfg as PromptGenPluginConfig) : null);
    promptGenConfigRef.current = kind === 'promptGen' ? (cfg as PromptGenPluginConfig) : null;
    setKnowledgeGenConfig(kind === 'knowledgeGen' ? (cfg as KnowledgeGenPluginConfig) : null);
    knowledgeGenConfigRef.current =
      kind === 'knowledgeGen' ? (cfg as KnowledgeGenPluginConfig) : null;
    setWsExpanded((prev) => ({ ...prev, [UNGROUPED_KEY]: true }));
  }

  function applyCaseGenConfig(cfg: CaseGenPluginConfig | null) {
    if (cfg?.active) {
      beginPluginSession('caseGen', cfg);
      return;
    }
    setCaseGenConfig(null);
    caseGenConfigRef.current = null;
    if (!storeRef.current) return;
    commitStore(updateActiveSessionMeta(storeRef.current, { caseGen: undefined }));
  }

  function applyPromptGenConfig(cfg: PromptGenPluginConfig | null) {
    if (cfg?.active) {
      beginPluginSession('promptGen', cfg);
      return;
    }
    setPromptGenConfig(null);
    promptGenConfigRef.current = null;
    if (!storeRef.current) return;
    commitStore(updateActiveSessionMeta(storeRef.current, { promptGen: undefined }));
  }

  function applyKnowledgeGenConfig(cfg: KnowledgeGenPluginConfig | null) {
    if (cfg?.active) {
      beginPluginSession('knowledgeGen', cfg);
      return;
    }
    setKnowledgeGenConfig(null);
    knowledgeGenConfigRef.current = null;
    if (!storeRef.current) return;
    commitStore(updateActiveSessionMeta(storeRef.current, { knowledgeGen: undefined }));
  }

  function newSession(workspacePath?: string) {
    if (!storeRef.current) return;
    setMainPane('chat');
    setChatTab('dialog');
    const leavingId = storeRef.current.activeId;
    saveComposerDraft(leavingId);
    resetComposer({ clearDraft: true });
    let base = pruneEphemeralSession(leavingId) ?? storeRef.current;
    // 仅显式传入 path（工作区右侧 +）才归入该工作区；顶部「新会话」进未分组
    const ws = workspacePath?.trim() || undefined;
    const next = createSession(base, ws ? { workspacePath: ws } : undefined);
    commitStore(next);
    setMessages([]);
    setCaseGenConfig(null);
    setPromptGenConfig(null);
    setKnowledgeGenConfig(null);
    if (ws) {
      setWsExpanded((prev) => ({ ...prev, [ws]: true }));
      if (fsLive && ws !== workspaceInfo?.workspace) void applyWorkspace(ws, 'select');
    } else {
      setWsExpanded((prev) => ({ ...prev, [UNGROUPED_KEY]: true }));
    }
  }

  function openSession(id: string) {
    if (!storeRef.current) return;
    setMainPane('chat');
    setChatTab('dialog');
    setSessionMenuId(null);
    if (id === storeRef.current.activeId) return;
    const leavingId = storeRef.current.activeId;
    saveComposerDraft(leavingId);
    abortRef.current?.abort();
    setStreaming(false);
    setError(null);
    setShowJump(false);
    followRef.current = true;
    let base = pruneEphemeralSession(leavingId) ?? storeRef.current;
    // 若丢掉的正是目标 id（不应发生），回退
    if (!base.sessions.some((x) => x.id === id)) base = storeRef.current;
    const next = switchSession(base, id);
    const s = next.sessions.find((x) => x.id === id);
    setMessages((s?.messages as LocalMessage[]) ?? []);
    setCaseGenConfig(s?.caseGen?.active ? s.caseGen : null);
    setPromptGenConfig(s?.promptGen?.active ? s.promptGen : null);
    setKnowledgeGenConfig(s?.knowledgeGen?.active ? s.knowledgeGen : null);
    restoreComposerDraft(id);
    commitStore(next);
    if (s?.workspacePath && fsLive && s.workspacePath !== workspaceInfo?.workspace) {
      void applyWorkspace(s.workspacePath, 'select');
    }
  }

  function removeSession(id: string, permanent = false) {
    if (!storeRef.current) return;
    setSessionMenuId(null);
    const cur = storeRef.current.sessions.find((x) => x.id === id);
    const wasActive = storeRef.current.activeId === id;
    if (wasActive) resetComposer({ clearDraft: true });
    delete composerDraftsRef.current[id];
    const next =
      permanent || cur?.deleted
        ? deleteSession(storeRef.current, id)
        : softDeleteSession(storeRef.current, id);
    commitStore(next);
    if (permanent || cur?.deleted) void deleteSessionMemory(id);
    if (wasActive) {
      const s = next.sessions.find((x) => x.id === next.activeId);
      setMessages((s?.messages as LocalMessage[]) ?? []);
      setCaseGenConfig(s?.caseGen?.active ? s.caseGen : null);
      setPromptGenConfig(s?.promptGen?.active ? s.promptGen : null);
      setKnowledgeGenConfig(s?.knowledgeGen?.active ? s.knowledgeGen : null);
    }
  }

  function restoreSession(id: string) {
    if (!storeRef.current) return;
    setSessionMenuId(null);
    commitStore(restoreDeletedSession(storeRef.current, id));
  }

  function toggleArchive(id: string, archived: boolean) {
    if (!storeRef.current) return;
    setSessionMenuId(null);
    const wasActive = storeRef.current.activeId === id && archived;
    if (wasActive) resetComposer();
    const next = archiveSession(storeRef.current, id, archived);
    commitStore(next);
    if (wasActive) {
      const s = next.sessions.find((x) => x.id === next.activeId);
      setMessages((s?.messages as LocalMessage[]) ?? []);
    }
  }

  function togglePin(id: string) {
    if (!storeRef.current) return;
    const s = storeRef.current.sessions.find((x) => x.id === id);
    if (!s) return;
    setSessionMenuId(null);
    commitStore(pinSession(storeRef.current, id, !s.pinned));
  }

  function renameSessionTitle(id: string) {
    if (!storeRef.current) return;
    if (!storeRef.current.sessions.some((x) => x.id === id)) return;
    setSessionMenuId(null);
    setRenameSessionId(id);
  }

  function confirmRenameSession(name: string) {
    if (!storeRef.current || !renameSessionId) return;
    commitStore(renameSession(storeRef.current, renameSessionId, name));
    setRenameSessionId(null);
  }

  function toggleRail() {
    setRailOpen((v) => {
      saveRailOpen(!v);
      return !v;
    });
  }

  /** 「添加文件」：文本 / Excel / Word 转正文附件，图片走多模态 */
  async function onPickFiles(e: ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    const nextAtt: Attachment[] = [];
    const nextImg: ImageAtt[] = [];
    const rejected: string[] = [];
    let used = composerFileCount(attachments, images);
    for (const f of list) {
      if (used >= FILE_MAX_COUNT) {
        rejected.push(`${f.name}（最多 ${FILE_MAX_COUNT} 个文件）`);
        continue;
      }
      try {
        const read = await readLocalAttachFile(f);
        if (read.kind === 'image') {
          nextImg.push(await fileToImageAtt(read.file));
        } else {
          nextAtt.push({ name: read.name, size: read.size, content: read.content });
        }
        used += 1;
      } catch (err) {
        rejected.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (nextAtt.length) setAttachments((prev) => [...prev, ...nextAtt]);
    if (nextImg.length) setImages((prev) => [...prev, ...nextImg]);
    setError(rejected.length ? `以下文件未添加：${rejected.join('、')}` : null);
    textareaRef.current?.focus();
  }

  /** 代码块「复制」按钮的事件委托（按钮由 renderMarkdown 生成） */
  function onTranscriptClick(e: ReactMouseEvent<HTMLDivElement>) {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-copy-code]');
    if (!btn) return;
    const code = btn.closest('.code-block')?.querySelector('pre')?.textContent ?? '';
    void copyText(code).then((ok) => {
      if (!ok) return;
      btn.textContent = '已复制';
      window.setTimeout(() => {
        btn.textContent = '复制';
      }, 1000);
    });
  }

  const empty = messages.length === 0;
  const canSend = Boolean(input.trim() || attachments.length || docRefs.length || images.length);
  let lastUserIdx = -1;
  let lastAssistantIdx = -1;
  messages.forEach((m, i) => {
    if (m.role === 'user') lastUserIdx = i;
    else if (m.role === 'assistant') lastAssistantIdx = i;
  });
  // dsh 规则：最新的用户/助手消息操作行常显，更早的消息悬停时显示
  const revealCls = (i: number) =>
    i === lastUserIdx || i === lastAssistantIdx
      ? ''
      : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity';
  const accessOpt = ACCESS_OPTIONS.find((o) => o.value === access) ?? ACCESS_OPTIONS[0];
  const activeSessions = (store?.sessions ?? []).filter((s) => !s.archived && !s.deleted);
  const archivedSessions = (store?.sessions ?? []).filter((s) => s.archived && !s.deleted);
  const deletedSessions = (store?.sessions ?? []).filter((s) => Boolean(s.deleted));
  const wsItems = workspaceInfo?.items ?? [];
  const wsPaths = new Set(wsItems.map((it) => it.path));
  const wsActivePath = workspaceInfo?.workspace ?? '';
  const qNorm = wsQuery.trim().toLowerCase();
  function sessionsForWorkspace(item: WorkspaceItem): ChatSession[] {
    return sortSessionsInGroup(
      activeSessions
        .filter((s) => s.workspacePath === item.path)
        .filter((s) => !qNorm || s.title.toLowerCase().includes(qNorm)),
    );
  }

  /** 无 workspacePath，或路径不在工作区列表中 → 未分组（对齐 dsh Ungrouped） */
  const ungroupedSessions = sortSessionsInGroup(
    activeSessions
      .filter((s) => !s.workspacePath || !wsPaths.has(s.workspacePath))
      .filter((s) => !qNorm || s.title.toLowerCase().includes(qNorm)),
  );

  const visibleWsItems = wsItems.filter((it) => {
    if (!qNorm) return true;
    if (it.name.toLowerCase().includes(qNorm) || it.path.toLowerCase().includes(qNorm)) {
      return true;
    }
    return sessionsForWorkspace(it).length > 0;
  });
  const showUngrouped = ungroupedSessions.length > 0;

  function SessionRow({ s, nested = false }: { s: ChatSession; nested?: boolean }) {
    const active = s.id === store?.activeId;
    const menuOpen = sessionMenuId === s.id;
    const busy = Boolean(streaming && active);
    return (
      <SessionRailRow
        s={s}
        nested={nested}
        active={active}
        menuOpen={menuOpen}
        busy={busy}
        onOpen={() => openSession(s.id)}
        onRename={() => renameSessionTitle(s.id)}
        onToggleMenu={() => {
          setWsMenuId(null);
          setSessionMenuId(menuOpen ? null : s.id);
        }}
        onTogglePin={() => togglePin(s.id)}
        onToggleArchive={() => toggleArchive(s.id, !s.archived)}
        onRemove={() => {
          if (s.deleted) setPurgeSessionId(s.id);
          else setDeleteSessionId(s.id);
        }}
        onRestore={s.deleted ? () => restoreSession(s.id) : undefined}
      />
    );
  }

  return (
    <div className="tw-app h-full flex bg-[color:var(--tw-surface-page)]">
      {/* dsh 风格：工作区树 + 会话挂在文件夹下 */}
      <aside
        className={`tw-session-rail shrink-0 border-r border-[color:var(--tw-border)] flex flex-col transition-[width] ${
          railOpen ? 'w-64' : 'w-10'
        }`}
      >
        <div
          className={`flex items-center gap-1 ${
            railOpen ? 'px-2.5 pt-2.5' : 'px-1 pt-2 justify-center'
          }`}
        >
          {railOpen && (
            <div className="flex-1 min-w-0 text-[13px] font-medium text-stone-700 truncate px-1">
              {t('chat.workbench', undefined, generalPrefs.language)}
            </div>
          )}
          <button
            type="button"
            onClick={toggleRail}
            title={railOpen ? '收起侧栏' : '展开侧栏'}
            className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-stone-500 hover:bg-stone-200/70"
          >
            <Svg className="w-4 h-4">
              {railOpen ? (
                <>
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M9 3v18" />
                </>
              ) : (
                <>
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                </>
              )}
            </Svg>
          </button>
        </div>

        {railOpen ? (
          <div className="px-2.5 pt-2 space-y-1.5">
            <button
              type="button"
              onClick={() => newSession()}
              className="w-full h-9 flex items-center justify-center gap-1.5 text-[13px] font-medium text-stone-700 bg-white rounded-full border border-stone-200/80 shadow-sm hover:bg-stone-50 transition-colors"
            >
              <Svg className="w-3.5 h-3.5">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </Svg>
              {t('chat.newSession', undefined, generalPrefs.language)}
            </button>
            <button
              type="button"
              title="我的插件"
              onClick={() => {
                const leaving = storeRef.current?.activeId;
                const pruned = pruneEphemeralSession(leaving);
                if (pruned && pruned !== storeRef.current) {
                  commitStore(pruned);
                  const s = pruned.sessions.find((x) => x.id === pruned.activeId);
                  setMessages((s?.messages as LocalMessage[]) ?? []);
                  resetComposer({ clearDraft: true });
                }
                setMainPane('plugins');
              }}
              className={`tw-rail-plugin-btn w-full h-9 flex items-center justify-center gap-1.5 text-[13px] font-medium rounded-full transition-colors ${
                mainPane === 'plugins' ? 'is-active' : ''
              }`}
            >
              <PluginIcon className="w-3.5 h-3.5" />
              插件
            </button>
          </div>
        ) : (
          <div className="px-1 pt-1 flex flex-col gap-1">
            <button
              type="button"
              onClick={() => newSession()}
              title="新会话"
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[#4176e6] hover:bg-white/80"
            >
              <Svg className="w-4 h-4">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </Svg>
            </button>
            <button
              type="button"
              title="我的插件"
              onClick={() => {
                const leaving = storeRef.current?.activeId;
                const pruned = pruneEphemeralSession(leaving);
                if (pruned && pruned !== storeRef.current) {
                  commitStore(pruned);
                  const s = pruned.sessions.find((x) => x.id === pruned.activeId);
                  setMessages((s?.messages as LocalMessage[]) ?? []);
                  resetComposer({ clearDraft: true });
                }
                setMainPane('plugins');
              }}
              className={`tw-rail-plugin-btn tw-rail-plugin-btn--icon w-8 h-8 flex items-center justify-center rounded-lg ${
                mainPane === 'plugins' ? 'is-active' : ''
              }`}
            >
              <PluginIcon className="w-4 h-4" />
            </button>
          </div>
        )}

        {railOpen && (
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-3">
            <div className="flex items-center gap-1 px-1.5 pb-2">
              <div className="flex-1 text-[12px] font-semibold text-stone-500">
                {t('chat.workspace', undefined, generalPrefs.language)}
              </div>
              <button
                type="button"
                title="搜索"
                onClick={() => {
                  setWsSearchOpen((v) => !v);
                  if (wsSearchOpen) setWsQuery('');
                }}
                className="w-6 h-6 flex items-center justify-center rounded text-stone-400 hover:text-stone-700 hover:bg-stone-200/70"
              >
                <SearchIcon className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title={fsLive ? '添加工作区（选择本地文件夹）' : '本地文件服务未就绪'}
                disabled={!fsLive || wsBusy}
                onClick={() => void addWorkspaceByPicker()}
                className="w-6 h-6 flex items-center justify-center rounded text-stone-400 hover:text-stone-700 hover:bg-stone-200/70 disabled:opacity-40"
              >
                <PlusSquareIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {wsSearchOpen && (
              <input
                value={wsQuery}
                onChange={(e) => setWsQuery(e.target.value)}
                placeholder="搜索工作区或会话"
                className="w-full mb-2 px-2.5 py-1.5 text-[12px] rounded-lg border border-stone-200 bg-white text-stone-700 placeholder:text-stone-400 focus:outline-none focus:ring-1 focus:ring-[#4176e6]/40"
              />
            )}

            {!fsLive && (
              <div className="px-1.5 py-2 text-[11px] text-amber-700/80">
                本地文件服务未就绪，工作区暂不可用
              </div>
            )}

            <div className="space-y-0.5">
              {visibleWsItems.map((item) => {
                const kids = sessionsForWorkspace(item);
                const expanded = Boolean(wsExpanded[item.path] ?? kids.length > 0);
                const isActiveWs = item.path === wsActivePath;
                const menuOpen = wsMenuId === item.id;
                return (
                  <div key={item.id}>
                    <div
                      className={`tw-project-row group relative ${isActiveWs ? 'is-active' : ''} ${
                        expanded ? 'is-expanded' : ''
                      } ${menuOpen ? 'is-menu-open' : ''}`}
                    >
                      <button
                        type="button"
                        title={item.path}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSessionMenuId(null);
                          setWsMenuId(null);
                          setWsExpanded((prev) => ({ ...prev, [item.path]: !expanded }));
                          if (fsLive && item.path !== wsActivePath) {
                            void applyWorkspace(item.path, 'select');
                          }
                        }}
                        className="flex-1 min-w-0 h-full flex items-center gap-1.5 text-left outline-none focus:outline-none"
                      >
                        <span className="tw-slot tw-folder">
                          <FolderIcon className="w-3.5 h-3.5" />
                        </span>
                        <span className="tw-slot tw-chevron">
                          <TriangleChevron open={expanded} className="w-3 h-3" />
                        </span>
                        <span className="tw-project-title">{item.name}</span>
                      </button>
                      <div className="tw-ws-actions relative shrink-0" data-ws-menu="">
                        <div className="relative">
                          <button
                            type="button"
                            title="更多"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSessionMenuId(null);
                              setWsMenuId(menuOpen ? null : item.id);
                            }}
                            className="w-6 h-6 flex items-center justify-center rounded text-[color:var(--tw-label-tertiary)] hover:text-[color:var(--tw-label-primary)] hover:bg-[color:var(--tw-session-hover-bg)]"
                          >
                            <EllipsisIcon className="w-3.5 h-3.5" />
                          </button>
                          {menuOpen && (
                            <div className="tw-popover absolute right-0 top-full z-50 mt-1 w-40 rounded-xl border border-stone-200 py-1 shadow-lg">
                              <button
                                type="button"
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-stone-700 hover:bg-stone-50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setWsMenuId(null);
                                  setWsRenameId(item.id);
                                }}
                              >
                                <Svg className="w-3.5 h-3.5">
                                  <path d="M12 20h9" />
                                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                                </Svg>
                                重命名
                              </button>
                              {item.id !== 'ws_project' && (
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    requestDropWorkspace(item);
                                  }}
                                >
                                  <Svg className="w-3.5 h-3.5">
                                    <path d="M3 6h18" />
                                    <path d="M8 6V4h8v2" />
                                    <path d="M19 6l-1 14H6L5 6" />
                                  </Svg>
                                  删除工作区
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          title="在此工作区新建会话"
                          onClick={(e) => {
                            e.stopPropagation();
                            newSession(item.path);
                          }}
                          className="w-6 h-6 flex items-center justify-center rounded text-[color:var(--tw-label-tertiary)] hover:text-[color:var(--tw-label-primary)] hover:bg-[color:var(--tw-session-hover-bg)]"
                        >
                          <Svg className="w-3.5 h-3.5">
                            <path d="M5 12h14" />
                            <path d="M12 5v14" />
                          </Svg>
                        </button>
                      </div>
                    </div>
                    {expanded && kids.map((s) => <SessionRow key={s.id} s={s} nested />)}
                  </div>
                );
              })}
              {/* 未分组固定靠后 */}
              {showUngrouped &&
                (() => {
                  const expanded = Boolean(wsExpanded[UNGROUPED_KEY] ?? true);
                  return (
                    <div>
                      <button
                        type="button"
                        title={expanded ? '收起' : '展开'}
                        onClick={(e) => {
                          e.stopPropagation();
                          setWsExpanded((prev) => ({
                            ...prev,
                            [UNGROUPED_KEY]: !expanded,
                          }));
                        }}
                        className={`tw-project-row group w-full text-left outline-none focus:outline-none ${
                          expanded ? 'is-expanded' : ''
                        }`}
                      >
                        <span className="tw-slot tw-folder">
                          <FolderIcon className="w-3.5 h-3.5" />
                        </span>
                        <span className="tw-slot tw-chevron">
                          <TriangleChevron open={expanded} className="w-3 h-3" />
                        </span>
                        <span className="tw-project-title text-[color:var(--tw-label-tertiary)]">
                          未分组
                        </span>
                      </button>
                      {expanded &&
                        ungroupedSessions.map((s) => <SessionRow key={s.id} s={s} nested />)}
                    </div>
                  );
                })()}
              {!visibleWsItems.length && !showUngrouped && fsLive && (
                <div className="px-2 py-3 text-xs text-stone-400">暂无工作区</div>
              )}
            </div>

            {archivedSessions.length > 0 && (
              <div className="mt-3 pt-2 border-t border-stone-200/60">
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  className="w-full flex items-center gap-1 px-1.5 pb-1 text-[11px] text-stone-400 hover:text-stone-600"
                >
                  <ChevronIcon
                    className={`w-3 h-3 transition-transform ${showArchived ? 'rotate-180' : ''}`}
                  />
                  归档 ({archivedSessions.length})
                </button>
                {showArchived && (
                  <div className="space-y-0.5">
                    {archivedSessions.map((s) => (
                      <SessionRow key={s.id} s={s} />
                    ))}
                  </div>
                )}
              </div>
            )}
            {deletedSessions.length > 0 && (
              <div className="mt-2 pt-2 border-t border-stone-200/60">
                <button
                  type="button"
                  onClick={() => setShowDeleted((v) => !v)}
                  className="w-full flex items-center gap-1 px-1.5 pb-1 text-[11px] text-stone-400 hover:text-stone-600"
                >
                  <ChevronIcon
                    className={`w-3 h-3 transition-transform ${showDeleted ? 'rotate-180' : ''}`}
                  />
                  已删除 ({deletedSessions.length})
                </button>
                {showDeleted && (
                  <div className="space-y-0.5">
                    {deletedSessions.map((s) => (
                      <SessionRow key={s.id} s={s} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {railOpen && (wsActivePath || toolBusy || toolHint) && (
          <div className="shrink-0 border-t border-stone-200/60 px-3 py-2 space-y-1">
            {wsActivePath && (
              <div className="tw-rail-workspace-footer" title={wsActivePath}>
                <span className="tw-rail-workspace-label" data-i18n="chat.workspace">
                  工作区
                </span>
                <span className="tw-rail-workspace-name">
                  {shortWorkspaceLabel(wsActivePath)}
                </span>
              </div>
            )}
            {(toolBusy || toolHint) && (
              <div className="text-[11px] text-[color:var(--tw-accent)]">
                {toolHint ?? t('tool.running', undefined, generalPrefs.language)}
              </div>
            )}
          </div>
        )}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {mainPane === 'plugins' ? (
          <div className="flex-1 min-h-0 overflow-hidden bg-[color:var(--tw-surface-page)]">
            <PluginsPage tab="mine" embedded />
          </div>
        ) : (
          <>
            {/* dsh 风格：会话标题 + Tab（对话 | 会话记忆） */}
            <div className="shrink-0 border-b border-[color:var(--tw-border)] bg-[color:var(--tw-surface-page)]">
              <div className="flex items-center gap-3 px-6 pt-4 pb-2 min-w-0">
                <button
                  type="button"
                  title="点击重命名"
                  onClick={() => {
                    const id = store?.activeId;
                    if (id) renameSessionTitle(id);
                  }}
                  className="min-w-0 flex-1 text-left text-[18px] leading-7 font-semibold text-[color:var(--tw-label-primary)] truncate hover:text-[#4176e6] transition-colors"
                >
                  {store?.sessions.find((x) => x.id === store.activeId)?.title || '新对话'}
                </button>
              </div>
              <div className="flex items-center gap-6 px-6">
                <button
                  type="button"
                  onClick={() => setChatTab('dialog')}
                  className={`relative h-10 text-sm transition-colors ${
                    chatTab !== 'memory' || !pluginOn.memory
                      ? 'text-[#4176e6] font-medium'
                      : 'text-stone-500 hover:text-stone-700'
                  }`}
                >
                  对话
                  {(chatTab !== 'memory' || !pluginOn.memory) && (
                    <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#4176e6] rounded-full" />
                  )}
                </button>
                {pluginOn.memory && (
                  <button
                    type="button"
                    onClick={() => setChatTab('memory')}
                    className={`relative h-10 text-sm transition-colors ${
                      chatTab === 'memory'
                        ? 'text-[#4176e6] font-medium'
                        : 'text-stone-500 hover:text-stone-700'
                    }`}
                  >
                    记忆
                    {chatTab === 'memory' && (
                      <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-[#4176e6] rounded-full" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {chatTab === 'memory' && pluginOn.memory ? (
              <div className="flex-1 min-h-0 bg-[color:var(--tw-surface-page)]">
                <MemoryPane
                  live={memoryLive}
                  pluginOn={Boolean(pluginOn.memory)}
                  workspacePath={
                    store?.sessions.find((s) => s.id === store.activeId)?.workspacePath ||
                    workspaceInfo?.workspace ||
                    ''
                  }
                />
              </div>
            ) : (
              <>
                {/* 消息区（字号跟通用设置） */}
                <div className="relative flex-1 min-h-0">
                  <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="h-full overflow-y-auto px-6 py-6"
                    style={{
                      fontSize: `var(--tw-session-font-size, ${generalPrefs.sessionFontSize}px)`,
                    }}
                  >
                    {empty ? (
                      <div className="h-full flex flex-col items-center justify-center text-center">
                        <div className="w-10 h-10 rounded-xl bg-[#4176e6]/10 flex items-center justify-center">
                          <span className="w-3 h-3 rounded-sm bg-[#4176e6]" />
                        </div>
                        <h2 className="mt-4 text-base font-medium text-stone-800">
                          {t('chat.emptyTitle', undefined, generalPrefs.language)}
                        </h2>
                        <p className="mt-1 text-sm text-stone-500 max-w-md">
                          {settings
                            ? t(
                                'chat.emptyWithModel',
                                { model: settings.model },
                                generalPrefs.language,
                              )
                            : t('chat.emptyNoModel', undefined, generalPrefs.language)}
                        </p>
                        {!settings && (
                          <button
                            onClick={() => openSettings('model')}
                            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] transition-colors"
                          >
                            {t('chat.configureModel', undefined, generalPrefs.language)}
                          </button>
                        )}
                        {settings && (
                          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-xl w-full">
                            {SUGGESTIONS.map((s) => (
                              <button
                                key={s}
                                onClick={() => send(s)}
                                className="px-4 py-3 text-left text-sm text-stone-600 bg-white border border-stone-200 rounded-xl hover:border-[#4176e6] hover:text-[#4176e6] transition-colors"
                              >
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        className="max-w-[748px] mx-auto flex flex-col gap-4"
                        onClick={onTranscriptClick}
                      >
                        {messages.map((m, i) =>
                          m.role === 'user' ? (
                            // dsh MessageItem：浅品牌蓝气泡居右，下方「时间 + 复制」
                            <div key={i} className="group flex flex-col items-end gap-1">
                              {m.refs?.length || m.attachments?.length || m.images?.length ? (
                                <div className="flex flex-wrap justify-end gap-1.5 max-w-[82%]">
                                  {m.refs?.map((r) => (
                                    <span
                                      key={r.path}
                                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-[#4176e6] bg-white border border-[#4176e6]/30 rounded-lg"
                                      title={r.path}
                                    >
                                      <FileIcon className="w-3.5 h-3.5" />
                                      <span className="text-[10px] text-stone-400 shrink-0">
                                        {formatSlashBadge(r.format)}
                                      </span>
                                      <span className="max-w-40 truncate">{r.title}</span>
                                    </span>
                                  ))}
                                  {m.attachments?.map((a) => (
                                    <span
                                      key={a.name}
                                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-stone-600 bg-white border border-stone-200 rounded-lg"
                                    >
                                      <FileIcon className="w-3.5 h-3.5 text-[#4176e6]" />
                                      <span className="max-w-48 truncate">{a.name}</span>
                                      <span className="text-stone-400">{fmtSize(a.size)}</span>
                                    </span>
                                  ))}
                                  {m.images?.map((img) => (
                                    <a
                                      key={img.id}
                                      href={img.dataUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block overflow-hidden rounded-lg border border-stone-200 bg-white"
                                      title={img.name}
                                    >
                                      <img
                                        src={img.dataUrl}
                                        alt={img.name}
                                        className="max-h-40 max-w-[12rem] object-contain"
                                      />
                                    </a>
                                  ))}
                                </div>
                              ) : null}
                              {m.content && (
                                <div className="tw-chat-text max-w-[82%] px-4 py-2.5 bg-[#edf3fe] rounded-2xl whitespace-pre-wrap break-words">
                                  {m.content}
                                </div>
                              )}
                              <div className={`flex items-center gap-1 h-7 ${revealCls(i)}`}>
                                {m.time != null && (
                                  <span className="pr-1.5 text-[13px] text-stone-400 tabular-nums">
                                    {fmtClock(m.time)}
                                  </span>
                                )}
                                <CopyButton text={m.content} />
                              </div>
                            </div>
                          ) : (
                            // dsh AssistantMarkdown：助手无气泡、全宽排版，下方「复制 · 用量 · 时间」
                            <div key={i} className="group">
                              {(() => {
                                // 思考块：仿 DeepSeek Harness ReasoningRow——默认收起、整行点击展开、
                                // 思考中 shimmer 标题 + 流式摘要，完成后显示耗时
                                const waiting =
                                  i === messages.length - 1 && streaming && m.content === '';
                                const showThink = waiting || !!m.reasoning;
                                if (!showThink) return null;
                                const open = m.reasoningOpen ?? false;
                                const summary =
                                  waiting && !open && m.reasoning
                                    ? latestParagraphFirstLine(m.reasoning).replaceAll('**', '')
                                    : '';
                                return (
                                  <div className="mb-2">
                                    <button
                                      type="button"
                                      onClick={(e) => toggleReasoning(i, e)}
                                      className="flex w-full items-center gap-2 py-1 text-left select-none"
                                    >
                                      {waiting ? (
                                        <span className="w-3.5 h-3.5 shrink-0 rounded-full border-2 border-purple-400 border-t-transparent animate-spin" />
                                      ) : (
                                        <Svg className="w-3.5 h-3.5 shrink-0 text-stone-400">
                                          <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
                                          <path d="M9 18h6" />
                                          <path d="M10 22h4" />
                                        </Svg>
                                      )}
                                      <span
                                        className={`text-[13px] font-medium shrink-0 ${waiting ? 'text-shimmer' : 'text-shimmer-static'}`}
                                      >
                                        {waiting ? '思考中…' : '思考完成'}
                                      </span>
                                      {!waiting && m.reasoningDuration != null && (
                                        <span className="text-xs text-stone-400 shrink-0">
                                          {m.reasoningDuration}s
                                        </span>
                                      )}
                                      <ChevronIcon
                                        className={`w-3.5 h-3.5 shrink-0 text-stone-400 transition-transform ${open ? 'rotate-180' : ''}`}
                                      />
                                      {summary ? (
                                        <span className="flex-1 min-w-0 truncate text-xs text-shimmer-muted think-mask">
                                          {summary}
                                        </span>
                                      ) : null}
                                    </button>
                                    {open && m.reasoning ? (
                                      <div className="mt-1.5 mb-2 pl-[22px] text-[13px] leading-5 text-stone-500 whitespace-pre-wrap max-h-80 overflow-y-auto">
                                        {m.reasoning}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })()}
                              {m.content ? (
                                <div
                                  className="chat-md prose prose-sm prose-stone max-w-none tw-chat-text"
                                  dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                                />
                              ) : i === messages.length - 1 && streaming ? null : (
                                <span className="inline-block w-2 h-4 bg-[#4176e6] animate-pulse" />
                              )}
                              {m.caseFile ? (
                                <button
                                  type="button"
                                  data-focus-doc={`cases:${m.caseFile.path.replace(/\\/g, '/')}`}
                                  title="双击本地打开"
                                  onDoubleClick={() => {
                                    void openDocsFile('cases', m.caseFile!.path).catch((e) =>
                                      setError(e instanceof Error ? e.message : String(e)),
                                    );
                                  }}
                                  className="mt-3 w-full max-w-md flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left hover:border-[#4176e6] hover:bg-[#f5f8ff] transition-colors cursor-pointer"
                                >
                                  <span className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center text-[10px] font-semibold shrink-0">
                                    {m.caseFile.name.split('.').pop()?.toUpperCase() || 'FILE'}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-sm text-stone-800 truncate">
                                      {m.caseFile.name}
                                    </span>
                                    <span className="block text-[11px] text-stone-400 truncate">
                                      {docRootLabelPath('cases')}
                                      {m.caseFile.path}
                                      {m.caseFile.count > 0 ? ` · ${m.caseFile.count} 条` : ''}
                                      {' · 双击本地打开'}
                                    </span>
                                  </span>
                                </button>
                              ) : null}
                              {m.docsFile ? (
                                <button
                                  type="button"
                                  data-focus-doc={`${m.docsFile.root}:${m.docsFile.path.replace(/\\/g, '/')}`}
                                  title="点击本地打开"
                                  onClick={() => {
                                    void openDocsFile(m.docsFile!.root, m.docsFile!.path).catch(
                                      (e) => setError(e instanceof Error ? e.message : String(e)),
                                    );
                                  }}
                                  className="mt-3 w-full max-w-md flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left hover:border-[#4176e6] hover:bg-[#f5f8ff] transition-colors cursor-pointer"
                                >
                                  <span
                                    className={`w-10 h-10 rounded-lg flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                                      m.docsFile.root === 'knowledge'
                                        ? 'bg-amber-50 text-amber-800'
                                        : 'bg-sky-50 text-sky-700'
                                    }`}
                                  >
                                    {m.docsFile.name.split('.').pop()?.toUpperCase() || 'MD'}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-sm text-stone-800 truncate">
                                      {m.docsFile.name}
                                    </span>
                                    <span className="block text-[11px] text-stone-400 truncate">
                                      {docRootLabelPath(m.docsFile.root)}
                                      {m.docsFile.path}
                                      {m.docsFile.note ? ` · ${m.docsFile.note}` : ''}
                                      {' · 点击打开'}
                                    </span>
                                  </span>
                                </button>
                              ) : null}
                              {m.content && !(i === messages.length - 1 && streaming) ? (
                                <div
                                  className={`mt-1 flex items-center gap-1 h-7 text-stone-400 ${revealCls(i)}`}
                                >
                                  <CopyButton text={m.content} />
                                  {m.usage && (
                                    <span className="ml-1.5">
                                      <TurnUsageButton
                                        usage={m.usage}
                                        model={m.model ?? settings?.model}
                                      />
                                    </span>
                                  )}
                                  {m.time != null && (
                                    <span className="ml-1.5 text-xs tabular-nums">
                                      {fmtClock(m.time)}
                                    </span>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>

                  {/* 回到底部（离开贴底位置时出现） */}
                  {showJump && !empty && (
                    <button
                      type="button"
                      onClick={jumpToBottom}
                      title="回到底部"
                      className="absolute bottom-3 right-[max(1.5rem,calc(50%-374px))] w-8 h-8 rounded-full bg-white border border-stone-200 shadow-md flex items-center justify-center text-stone-500 hover:text-stone-800 transition-colors"
                    >
                      <ChevronIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* 错误提示 */}
                {error && (
                  <div className="shrink-0 px-6 pb-2">
                    <div className="max-w-[764px] mx-auto flex items-start gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-800">
                      <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-semibold">
                        !
                      </span>
                      <pre className="flex-1 min-w-0 m-0 font-sans text-[13px] leading-5 whitespace-pre-wrap break-words">
                        {error
                          .replace(/\*\*/g, '')
                          .replace(/\s*:\s*\*\*/g, ': ')
                          .trim()}
                      </pre>
                      <button
                        type="button"
                        onClick={() => setError(null)}
                        className="shrink-0 text-red-400 hover:text-red-600 text-xs"
                      >
                        关闭
                      </button>
                    </div>
                  </div>
                )}

                {/* 输入区：dsh composer——白色圆角卡片，左「+ / 权限」，右「模型·推理 / 发送」 */}
                <div className="shrink-0 px-6 pb-3">
                  <div className="max-w-[764px] mx-auto">
                    {promptGenConfig?.active && pluginOn.promptGen ? (
                      <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl border border-[#4176e6]/30 bg-[#edf3fe] text-xs text-[#3565c7]">
                        <span className="flex-1 min-w-0 truncate">
                          生成提示词已启用 · {promptGenConfigLabel(promptGenConfig)}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 hover:underline"
                          onClick={() => setPromptGenPanelOpen(true)}
                        >
                          改配置
                        </button>
                        <button
                          type="button"
                          className="shrink-0 text-stone-500 hover:text-stone-800"
                          onClick={() => applyPromptGenConfig(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : null}
                    {knowledgeGenConfig?.active && pluginOn.knowledgeGen ? (
                      <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-300/60 bg-amber-50 text-xs text-amber-900">
                        <span className="flex-1 min-w-0 truncate">
                          生成知识库已启用 · {knowledgeGenConfigLabel(knowledgeGenConfig)}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 hover:underline"
                          onClick={() => setKnowledgeGenPanelOpen(true)}
                        >
                          改配置
                        </button>
                        <button
                          type="button"
                          className="shrink-0 text-stone-500 hover:text-stone-800"
                          onClick={() => applyKnowledgeGenConfig(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : null}
                    {caseGenConfig?.active && pluginOn.caseGen ? (
                      <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl border border-[#4176e6]/30 bg-[#edf3fe] text-xs text-[#3565c7]">
                        <span className="flex-1 min-w-0 truncate">
                          生成测试用例已启用 · {caseGenConfigLabel(caseGenConfig)}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 hover:underline"
                          onClick={() => setCaseGenPanelOpen(true)}
                        >
                          改配置
                        </button>
                        <button
                          type="button"
                          className="shrink-0 text-stone-500 hover:text-stone-800"
                          onClick={() => applyCaseGenConfig(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : null}
                    {queueLen > 0 ? (
                      <div className="mb-1.5 px-1 text-[11px] text-stone-500">
                        已排队 {queueLen} 条，当前轮结束后按序发送
                      </div>
                    ) : null}
                    <div
                      ref={composerRef}
                      className="pt-2 rounded-[20px] bg-white border border-stone-200 shadow-[0_4px_20px_rgba(15,23,42,0.06)] transition-shadow focus-within:shadow-[0_4px_24px_rgba(65,118,230,0.14)]"
                    >
                      {(docRefs.length > 0 || attachments.length > 0 || images.length > 0) && (
                        <div className="flex flex-wrap gap-1.5 px-3 pt-0.5 pb-2">
                          {docRefs.map((r) => (
                            <span
                              key={`${r.collection}:${r.path}`}
                              className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 text-xs text-[#4176e6] bg-[#edf3fe] border border-[#4176e6]/25 rounded-lg"
                              title={r.path}
                            >
                              <FileIcon className="w-3.5 h-3.5" />
                              <span className="text-[10px] text-[#4176e6]/80 shrink-0">
                                {r.collection === 'workspace'
                                  ? '工作区'
                                  : formatSlashBadge(r.format)}
                              </span>
                              <span className="max-w-40 truncate">{r.title}</span>
                              <button
                                type="button"
                                title="移除引用"
                                onClick={() =>
                                  setDocRefs((prev) =>
                                    prev.filter(
                                      (x) => !(x.collection === r.collection && x.path === r.path),
                                    ),
                                  )
                                }
                                className="w-5 h-5 flex items-center justify-center rounded text-[#4176e6]/70 hover:text-[#4176e6] hover:bg-white/80"
                              >
                                <Svg className="w-3 h-3">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </Svg>
                              </button>
                            </span>
                          ))}
                          {attachments.map((a, idx) => (
                            <span
                              key={`${a.name}-${idx}`}
                              className="flex items-center gap-1.5 pl-2.5 pr-1 py-1 text-xs text-stone-600 bg-stone-50 border border-stone-200 rounded-lg"
                            >
                              <FileIcon className="w-3.5 h-3.5 text-[#4176e6]" />
                              <span className="max-w-48 truncate">{a.name}</span>
                              <span className="text-stone-400">{fmtSize(a.size)}</span>
                              <button
                                type="button"
                                title="移除"
                                onClick={() =>
                                  setAttachments((prev) => prev.filter((_, j) => j !== idx))
                                }
                                className="w-5 h-5 flex items-center justify-center rounded text-stone-400 hover:text-stone-700 hover:bg-stone-200"
                              >
                                <Svg className="w-3 h-3">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </Svg>
                              </button>
                            </span>
                          ))}
                          {images.map((img) => (
                            <span
                              key={img.id}
                              className="relative group inline-flex rounded-lg border border-stone-200 overflow-hidden bg-stone-50"
                              title={`${img.name} · ${fmtSize(img.size)}`}
                            >
                              <img
                                src={img.dataUrl}
                                alt={img.name}
                                className="h-14 w-14 object-cover"
                              />
                              <button
                                type="button"
                                title="移除图片"
                                onClick={() =>
                                  setImages((prev) => prev.filter((x) => x.id !== img.id))
                                }
                                className="absolute top-0.5 right-0.5 w-5 h-5 flex items-center justify-center rounded bg-black/55 text-white hover:bg-black/75"
                              >
                                <Svg className="w-3 h-3">
                                  <path d="M18 6 6 18" />
                                  <path d="m6 6 12 12" />
                                </Svg>
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="relative">
                        {pluginMenuOpen && (
                          <div
                            ref={pluginMenuRef}
                            className="tw-composer-menu absolute bottom-full left-0 right-0 mb-2 mx-2 z-40 max-h-64 overflow-y-auto rounded-xl border border-stone-200 shadow-xl p-1"
                          >
                            <div className="px-3 py-1.5 text-[11px] text-stone-400">插件</div>
                            {pluginMenuItems.map((p, i) => {
                              const on = Boolean(pluginOn[p.id]);
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  data-plugin-index={i}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onMouseEnter={() => setPluginIndex(i)}
                                  onClick={() => pickPluginMenu(p.id)}
                                  className={`tw-composer-menu-item w-full text-left px-3 py-2 rounded-lg transition-colors ${
                                    i === pluginIndex ? 'is-active' : ''
                                  } ${on ? '' : 'opacity-60'}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <div className="text-[13px] font-medium text-stone-800 flex-1">
                                      {p.name}
                                    </div>
                                    {!on ? (
                                      <span className="text-[10px] text-amber-700 shrink-0">
                                        未启用
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-0.5 text-xs text-stone-400 line-clamp-2">
                                    {p.description}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {atOpen && (
                          <div
                            ref={mentionListRef}
                            className="tw-composer-menu absolute bottom-full left-0 right-0 mb-2 mx-2 z-40 max-h-64 overflow-y-auto rounded-xl border border-stone-200 shadow-xl p-1"
                          >
                            {atFlatItems.length === 0 ? (
                              <div className="px-3 py-2 text-xs text-stone-400 space-y-1">
                                {!knowledgeOn ? (
                                  <p>项目文档：请先启用「知识库检索」插件</p>
                                ) : (
                                  <p>项目文档：无匹配</p>
                                )}
                                {!hasWorkspace ? (
                                  <p>工作区：请先在侧栏添加并选择工作区</p>
                                ) : (
                                  <p>工作区：无匹配</p>
                                )}
                              </div>
                            ) : (
                              <>
                                {atProjectDocs.length > 0 ? (
                                  <div className="px-3 py-1.5 text-[11px] font-medium text-stone-400">
                                    项目文档（{docRootLabel('knowledge')} /{' '}
                                    {docRootLabel('templates')}）
                                  </div>
                                ) : null}
                                {atFlatItems.map((item, i) => {
                                  const d = item.doc;
                                  const prev = atFlatItems[i - 1];
                                  const showWsHeader =
                                    item.section === 'workspace' && prev?.section !== 'workspace';
                                  return (
                                    <div key={`${d.collection}/${d.id}`}>
                                      {showWsHeader ? (
                                        <>
                                          {atProjectDocs.length > 0 ? (
                                            <div
                                              className="my-1 mx-2 border-t border-stone-200"
                                              role="separator"
                                            />
                                          ) : null}
                                          <div className="px-3 py-1.5 text-[11px] font-medium text-stone-400">
                                            工作区
                                          </div>
                                        </>
                                      ) : null}
                                      <button
                                        type="button"
                                        data-mention-index={i}
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => pickAtDoc(d)}
                                        className={`tw-composer-menu-item w-full text-left px-3 py-2 rounded-lg transition-colors ${
                                          i === mentionIndex ? 'is-active' : ''
                                        }`}
                                      >
                                        <div className="flex items-center gap-2 text-[13px] text-stone-800">
                                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 shrink-0">
                                            {d.collection === 'knowledge'
                                              ? docRootLabel('knowledge')
                                              : d.collection === 'templates'
                                                ? docRootLabel('templates')
                                                : d.format === 'dir'
                                                  ? '文件夹'
                                                  : '文件'}
                                          </span>
                                          {d.collection !== 'workspace' ? (
                                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 shrink-0">
                                              {formatSlashBadge(d.format)}
                                            </span>
                                          ) : null}
                                          <span className="truncate font-medium">{d.title}</span>
                                        </div>
                                        <div className="mt-0.5 pl-0 text-xs text-stone-400 truncate">
                                          {d.collection === 'workspace'
                                            ? d.path
                                            : `${d.category}${d.description ? ` · ${d.description}` : ''}`}
                                        </div>
                                      </button>
                                    </div>
                                  );
                                })}
                              </>
                            )}
                          </div>
                        )}
                        <textarea
                          ref={textareaRef}
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onPaste={(e) => {
                            const items = Array.from(e.clipboardData?.items ?? []);
                            const imageFiles = items
                              .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
                              .map((it) => it.getAsFile())
                              .filter((f): f is File => Boolean(f));
                            if (!imageFiles.length) return;
                            e.preventDefault();
                            void addImages(imageFiles);
                          }}
                          onKeyDown={(e) => {
                            if (pluginMenuOpen && pluginMenuItems.length) {
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setPluginIndex((i) => (i + 1) % pluginMenuItems.length);
                                return;
                              }
                              if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setPluginIndex(
                                  (i) => (i - 1 + pluginMenuItems.length) % pluginMenuItems.length,
                                );
                                return;
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setPluginMenuDismissed(true);
                                if (pluginSlashState)
                                  setInput(input.slice(0, pluginSlashState.from));
                                return;
                              }
                              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                const item = pluginMenuItems[pluginIndex] ?? pluginMenuItems[0];
                                if (item) pickPluginMenu(item.id);
                                return;
                              }
                            }
                            if (atOpen && atFlatItems.length) {
                              if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setMentionIndex((i) => (i + 1) % atFlatItems.length);
                                return;
                              }
                              if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setMentionIndex(
                                  (i) => (i - 1 + atFlatItems.length) % atFlatItems.length,
                                );
                                return;
                              }
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setMentionDismissed(true);
                                if (atState) setInput(input.slice(0, atState.from));
                                return;
                              }
                              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                const doc = atFlatItems[mentionIndex]?.doc;
                                if (doc) pickAtDoc(doc);
                                return;
                              }
                            }
                            if (e.key === 'Escape' && (atState || pluginSlashState)) {
                              e.preventDefault();
                              setMentionDismissed(true);
                              setPluginMenuDismissed(true);
                              const from = atState?.from ?? pluginSlashState?.from;
                              if (from != null) setInput(input.slice(0, from));
                              return;
                            }
                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                              e.preventDefault();
                              if (streamingRef.current) {
                                const primary = loadGeneralPrefs().busySendBehavior ?? 'queue';
                                const other: BusySendBehavior =
                                  primary === 'queue' ? 'interrupt' : 'queue';
                                const alt = e.metaKey || e.ctrlKey;
                                void send(undefined, { forceBusy: alt ? other : primary });
                              } else {
                                void send();
                              }
                            }
                          }}
                          rows={1}
                          placeholder={
                            settings
                              ? '请输入你的内容，使用 /  引用插件，使用 @ 引用文档'
                              : '请先配置模型（右下角「配置模型」或左下角「设置」→ 模型）'
                          }
                          className="tw-chat-input block w-full min-h-[36px] pl-[14px] pr-2 pt-1 pb-0 bg-transparent resize-none focus:outline-none placeholder:text-[color:var(--tw-label-tertiary)]"
                        />
                      </div>

                      <div className="flex items-center gap-1.5 px-3 pb-3 pt-3">
                        {/* 「+」：dsh 风格「添加 → 文件」 */}
                        <Menu>
                          <MenuButton
                            title="添加"
                            className="tw-icon-btn w-8 h-8 shrink-0 rounded-full flex items-center justify-center data-[open]:bg-[color:var(--tw-session-hover-bg)] transition-colors"
                          >
                            <Svg className="w-4 h-4">
                              <path d="M5 12h14" />
                              <path d="M12 5v14" />
                            </Svg>
                          </MenuButton>
                          <MenuItems
                            anchor={{ to: 'top start', gap: 8 }}
                            className="tw-select-menu z-50 w-[min(100vw-2rem,20rem)] rounded-xl border border-stone-200 py-1.5 shadow-xl focus:outline-none"
                          >
                            <div className="px-3 pt-1 pb-1.5 text-[11px] font-medium text-stone-400 tracking-wide">
                              添加
                            </div>
                            <MenuItem>
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-left data-[focus]:bg-stone-100"
                              >
                                <PaperclipIcon className="w-4 h-4 shrink-0 text-stone-500" />
                                <span className="text-[13px] text-stone-800">
                                  文件
                                  <span className="ml-1.5 text-stone-400 font-normal">file</span>
                                </span>
                              </button>
                            </MenuItem>
                          </MenuItems>
                        </Menu>

                        {/* 访问权限（dsh 左侧权限菜单） */}
                        <Menu>
                          <MenuButton
                            title="访问权限"
                            className="group flex items-center gap-1 h-7 max-w-[220px] pl-2 pr-1 text-[13px] leading-5 font-medium text-stone-600 rounded-md hover:bg-stone-100 data-[open]:bg-stone-100 transition-colors"
                          >
                            <ShieldIcon
                              level={access}
                              className="w-3.5 h-3.5 shrink-0 text-stone-500"
                            />
                            {accessOpt.label}
                            <span
                              className={`ml-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                                fsLive ? 'bg-emerald-500' : 'bg-stone-300'
                              }`}
                              title={fsLive ? 'Runner 在线' : 'Runner 离线'}
                            />
                            <ChevronIcon className="w-3.5 h-3.5 text-stone-400 transition-transform group-data-[open]:rotate-180" />
                          </MenuButton>
                          <MenuItems
                            anchor={{ to: 'top start', gap: 8 }}
                            className="tw-select-menu z-50 w-56 rounded-xl border border-stone-200 p-1 shadow-xl focus:outline-none"
                          >
                            <div className="px-3 py-1.5 text-[11px] text-stone-400">
                              {fsLive ? '本地文件服务已连接' : '本地文件服务未就绪'}
                            </div>
                            {ACCESS_OPTIONS.map((o) => (
                              <MenuItem key={o.value}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setAccess(o.value);
                                    saveAccessLevel(o.value);
                                  }}
                                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-[13px] data-[focus]:bg-stone-100"
                                >
                                  <ShieldIcon
                                    level={o.value}
                                    className="w-4 h-4 text-stone-500 shrink-0"
                                  />
                                  <span
                                    className={`flex-1 ${access === o.value ? 'text-stone-900 font-medium' : 'text-stone-700'}`}
                                  >
                                    {o.label}
                                  </span>
                                  {access === o.value && (
                                    <CheckIcon className="w-3.5 h-3.5 text-[#4176e6]" />
                                  )}
                                </button>
                              </MenuItem>
                            ))}
                          </MenuItems>
                        </Menu>

                        <span className="flex-1" />

                        <ModelEffortMenu settings={settings} />

                        {streaming ? (
                          <button
                            onClick={stop}
                            title="停止生成"
                            className="w-8 h-8 shrink-0 rounded-full bg-stone-200 text-stone-600 flex items-center justify-center hover:bg-stone-300 transition-colors"
                          >
                            <span className="w-2.5 h-2.5 bg-stone-600 rounded-[2px]" />
                          </button>
                        ) : null}
                        <button
                          onClick={() => {
                            if (streamingRef.current) {
                              void send(undefined, {
                                forceBusy: loadGeneralPrefs().busySendBehavior ?? 'queue',
                              });
                            } else {
                              void send();
                            }
                          }}
                          disabled={!canSend}
                          title={
                            streaming
                              ? generalPrefs.busySendBehavior === 'interrupt'
                                ? '插话发送'
                                : '排队发送'
                              : '发送'
                          }
                          className="w-8 h-8 shrink-0 rounded-full bg-[#4176e6] text-white flex items-center justify-center hover:bg-[#3565c7] disabled:bg-[#a9c3ef] disabled:cursor-not-allowed transition-colors"
                        >
                          <Svg className="w-4 h-4">
                            <path d="m5 12 7-7 7 7" />
                            <path d="M12 19V5" />
                          </Svg>
                        </button>
                      </div>
                    </div>

                    <StatusBar
                      messages={messages}
                      model={settings?.model}
                      systemPromptTokens={estimateTokens(systemPrompt)}
                    />
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    accept={[
                      ...ATTACH_ACCEPT_EXTS.map((x) => `.${x}`),
                      'image/*',
                      'text/*',
                      'application/json',
                      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      'application/vnd.ms-excel',
                      'application/msword',
                    ].join(',')}
                    onChange={(e) => void onPickFiles(e)}
                  />
                </div>
              </>
            )}
          </>
        )}
      </div>
      <CaseGenPanel
        open={caseGenPanelOpen}
        initial={caseGenConfig}
        onClose={() => setCaseGenPanelOpen(false)}
        onConfirm={(cfg) => applyCaseGenConfig(cfg)}
      />
      <PromptGenPanel
        open={promptGenPanelOpen}
        initial={promptGenConfig}
        onClose={() => setPromptGenPanelOpen(false)}
        onConfirm={(cfg) => applyPromptGenConfig(cfg)}
      />
      <KnowledgeGenPanel
        open={knowledgeGenPanelOpen}
        initial={knowledgeGenConfig}
        onClose={() => setKnowledgeGenPanelOpen(false)}
        onConfirm={(cfg) => applyKnowledgeGenConfig(cfg)}
      />
      <NamePromptDialog
        open={Boolean(renameSessionId)}
        title="重命名会话"
        label="会话名称"
        placeholder="请输入会话名称"
        initialValue={
          renameSessionId
            ? (store?.sessions.find((x) => x.id === renameSessionId)?.title ?? '')
            : ''
        }
        confirmLabel="保存"
        cancelLabel="取消"
        onClose={() => setRenameSessionId(null)}
        onConfirm={confirmRenameSession}
      />
      <NamePromptDialog
        open={Boolean(wsRenameId)}
        title="重命名工作区"
        label="显示名称"
        placeholder="请输入工作区名称"
        initialValue={
          wsRenameId
            ? (workspaceInfo?.items.find((x) => x.id === wsRenameId)?.name ?? '')
            : ''
        }
        confirmLabel="保存"
        cancelLabel="取消"
        onClose={() => setWsRenameId(null)}
        onConfirm={(name) => void confirmRenameWorkspace(name)}
      />
      <ConfirmDialog
        open={Boolean(deleteSessionId)}
        title="删除会话"
        message={
          deleteSessionId
            ? `确定删除「${store?.sessions.find((x) => x.id === deleteSessionId)?.title ?? '该会话'}」？会话将移至「已删除」。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        danger="outline"
        onClose={() => setDeleteSessionId(null)}
        onConfirm={() => {
          if (!deleteSessionId) return;
          const id = deleteSessionId;
          setDeleteSessionId(null);
          removeSession(id, false);
        }}
      />
      <ConfirmDialog
        open={Boolean(purgeSessionId)}
        title="永久删除"
        message={
          purgeSessionId
            ? `永久删除「${store?.sessions.find((x) => x.id === purgeSessionId)?.title ?? '该会话'}」？此操作不可恢复。`
            : ''
        }
        confirmLabel="永久删除"
        cancelLabel="取消"
        danger
        onClose={() => setPurgeSessionId(null)}
        onConfirm={() => {
          if (!purgeSessionId) return;
          const id = purgeSessionId;
          setPurgeSessionId(null);
          removeSession(id, true);
        }}
      />
      <ConfirmDialog
        open={Boolean(wsDeleteTarget)}
        title="删除工作区"
        message={
          wsDeleteTarget
            ? `将把「${wsDeleteTarget.name}」从工作区列表中移除。文件夹与会话记录会保留，其会话将显示在「未分组」下。`
            : ''
        }
        confirmLabel="删除工作区"
        cancelLabel="取消"
        danger="outline"
        onClose={() => setWsDeleteTarget(null)}
        onConfirm={() => void confirmDropWorkspace()}
      />
    </div>
  );
}
