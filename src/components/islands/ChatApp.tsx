import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
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
  bindSessionWorkspace,
  createSession,
  deleteSession,
  hydrateSessionStore,
  isEphemeralEmptySession,
  loadRailOpen,
  pinSession,
  renameSession,
  saveRailOpen,
  saveSessionStore,
  sortSessionsInGroup,
  switchSession,
  unbindSessionsFromWorkspace,
  appendSessionMessage,
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
  AGENT_INSTRUCTIONS_HINT_PREFIX,
  FS_SYSTEM_HINT,
  PRESENT_TOOL,
  addWorkspace,
  fetchAgentInstructions,
  fetchFsHealth,
  fetchWorkspace,
  fsToolsForAccess,
  listWorkspaceFlat,
  openFsPath,
  pickDirectory,
  removeWorkspace,
  renameWorkspace,
  runFsTool,
  runPresentTool,
  selectWorkspace,
  shortWorkspaceLabel,
  workspaceDisplayName,
  type FsHealth,
  type PresentFile,
  type WorkspaceFlatEntry,
  type WorkspaceInfo,
  type WorkspaceItem,
} from '../../lib/fs-tools';
import { formatTimeContext } from '../../lib/session-context';
import {
  ASK_USER_QUESTION_TOOL,
  SESSION_INTERACT_HINT,
  TODO_WRITE_TOOL,
  normalizeTodos,
  parseAskUserArgs,
  type AskUserAnswer,
  type AskUserQuestion,
  type TodoItem,
} from '../../lib/session-interact';
import {
  PLAN_MODE_HINT_APPROVED,
  PLAN_MODE_HINT_PLANNING,
  SUBMIT_PLAN_TOOL,
  parseSubmitPlanArgs,
  type PlanPhase,
  type PlanProposal,
} from '../../lib/session-plan';
import {
  compactMessageList,
  isCompactCommand,
  needsAutoCompact,
  type CompactableMessage,
} from '../../lib/session-compact';
import {
  GOAL_SYSTEM_HINT,
  GOAL_TOOLS,
  activeGoalText,
  formatGoalForModel,
  isGoalCommand,
  normalizeGoal,
  parseGoalCommand,
  type SessionGoal,
} from '../../lib/session-goal';
import {
  SCHEDULE_SYSTEM_HINT,
  SCHEDULE_TOOLS,
  claimDueSchedules,
  runScheduleTool,
} from '../../lib/session-schedule';
import { SUBAGENT_SYSTEM_HINT, SUBAGENT_TOOLS, runSubagentTool } from '../../lib/session-subagent';
import { WORKFLOW_SYSTEM_HINT, WORKFLOW_TOOLS, runWorkflowTool } from '../../lib/session-workflow';
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
import {
  fetchWebHealth,
  WEB_SYSTEM_HINT,
  WEB_TOOLS,
  runWebTool,
  webToolDetail,
  type WebHealth,
} from '../../lib/web-tools';
import {
  BASH_SESSION_TOOLS,
  BASH_SYSTEM_HINT,
  BASH_TOOL,
  JOB_TOOLS,
  PWSH_SYSTEM_HINT,
  PWSH_TOOL,
  fetchBashHealth,
  fetchPwshHealth,
  runBashSessionTool,
  runBashTool,
  runJobTool,
  runPwshTool,
  type BashHealth,
  type PwshHealth,
} from '../../lib/bash-tools';
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
import ConfirmDialog from './ConfirmDialog';
import MemoryPane from './MemoryPane';
import NamePromptDialog from './NamePromptDialog';

export type SlashDoc = SlashDocItem;

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
  opts: {
    memory: boolean;
    knowledge: boolean;
    fs: boolean;
    web: boolean;
    bash: boolean;
    pwsh: boolean;
    interact: boolean;
    planPhase: PlanPhase;
    goalEnabled: boolean;
    goal: SessionGoal | null;
    scheduleEnabled: boolean;
    subagentEnabled: boolean;
    workflowEnabled: boolean;
  },
): ChatMessage[] {
  let system = systemPrompt;
  if (opts.knowledge) system = `${system}\n\n${KB_SYSTEM_HINT}`;
  if (opts.fs) system = `${system}\n\n${FS_SYSTEM_HINT}`;
  if (opts.bash) system = `${system}\n\n${BASH_SYSTEM_HINT}`;
  if (opts.pwsh) system = `${system}\n\n${PWSH_SYSTEM_HINT}`;
  if (opts.web) system = `${system}\n\n${WEB_SYSTEM_HINT}`;
  if (opts.memory) system = `${system}\n\n${MEMORY_SYSTEM_HINT}`;
  if (opts.interact) system = `${system}\n\n${SESSION_INTERACT_HINT}`;
  if (opts.planPhase === 'planning') system = `${system}\n\n${PLAN_MODE_HINT_PLANNING}`;
  if (opts.planPhase === 'approved') system = `${system}\n\n${PLAN_MODE_HINT_APPROVED}`;
  if (opts.goalEnabled) {
    system = `${system}\n\n${GOAL_SYSTEM_HINT}`;
    const g = activeGoalText(opts.goal);
    if (g) system = `${system}\n\n【当前会话目标】${g}`;
  }
  if (opts.scheduleEnabled) system = `${system}\n\n${SCHEDULE_SYSTEM_HINT}`;
  if (opts.subagentEnabled) system = `${system}\n\n${SUBAGENT_SYSTEM_HINT}`;
  if (opts.workflowEnabled) system = `${system}\n\n${WORKFLOW_SYSTEM_HINT}`;
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
  /** present 工具声明的工作区交付文件 */
  presentFiles?: PresentFile[];
  /** dsh 风格工具步骤时间线 */
  activitySteps?: ActivityStep[];
  activityOpen?: boolean;
}

/** 对齐 dsh 执行轨迹：思考 / 网页 / 本地文件等 */
interface ActivityStep {
  id: string;
  kind: 'thinking' | 'web_search' | 'web_fetch' | 'fs' | 'kb' | 'memory' | 'tool';
  title: string;
  detail?: string;
  status: 'running' | 'done' | 'error';
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

/** 空会话快捷话题：贴合工作区探查 / 用例设计 / 缺陷规范 / 方法组合 */
const SUGGESTIONS = [
  '当前工作区里有哪些关键目录和文件？帮我快速摸清项目结构',
  '为「用户登录」梳理测试点，按 P0/P1 排优先级并标出风险',
  '支付回调接口要覆盖哪些异常与幂等场景？给出用例大纲',
  '给我一份可直接套用的缺陷报告字段模板（含复现步骤）',
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
  if (name === 'present') return '交付文件';
  if (name === 'todo_write') return '待办';
  if (name === 'ask_user_question') return '向用户提问';
  if (name === 'bash') return 'Bash';
  if (name === 'pwsh') return 'PowerShell';
  if (name.startsWith('bash_session_')) return '持久终端';
  if (name === 'submit_plan') return '提交计划';
  if (name.startsWith('goal_')) return '会话目标';
  if (name.startsWith('schedule_')) return '定时提醒';
  if (
    name === 'list_agents' ||
    name === 'spawn_subagent' ||
    name === 'fork_subagent' ||
    name.startsWith('subagent_')
  ) {
    return '子代理';
  }
  if (name === 'workflow') return '工作流';
  if (name === 'job_list') return '任务列表';
  if (name === 'job_output') return '任务输出';
  if (name === 'job_kill') return '终止任务';
  if (name === 'web_search') return t('tool.kind.webSearch');
  if (name === 'web_fetch') return t('tool.kind.webFetch');
  if (name.startsWith('kb_')) return t('tool.kind.kb');
  if (name.startsWith('fs_')) return t('tool.kind.fs');
  if (name.startsWith('memory_')) return t('tool.kind.memory');
  return name;
}

function activityKindForTool(name: string): ActivityStep['kind'] {
  if (name === 'present') return 'fs';
  if (
    name === 'todo_write' ||
    name === 'ask_user_question' ||
    name === 'bash' ||
    name === 'pwsh' ||
    name.startsWith('bash_session_') ||
    name === 'submit_plan' ||
    name.startsWith('goal_') ||
    name.startsWith('schedule_') ||
    name === 'list_agents' ||
    name === 'spawn_subagent' ||
    name === 'fork_subagent' ||
    name.startsWith('subagent_') ||
    name === 'workflow' ||
    name.startsWith('job_')
  ) {
    return 'tool';
  }
  if (name === 'web_search') return 'web_search';
  if (name === 'web_fetch') return 'web_fetch';
  if (name.startsWith('fs_')) return 'fs';
  if (name.startsWith('kb_')) return 'kb';
  if (name.startsWith('memory_')) return 'memory';
  return 'tool';
}

function toolArgsDetail(name: string, argsJson?: string): string {
  if (!argsJson) return '';
  if (name.startsWith('web_')) return webToolDetail(name, argsJson);
  if (name === 'present') {
    try {
      const a = JSON.parse(argsJson) as { files?: Array<{ path?: string }> };
      const paths = (a.files ?? []).map((f) => f.path).filter(Boolean);
      return paths.slice(0, 3).join(', ') + (paths.length > 3 ? '…' : '');
    } catch {
      return '';
    }
  }
  try {
    const a = JSON.parse(argsJson) as Record<string, unknown>;
    if (name === 'submit_plan') {
      const title = typeof a.title === 'string' ? a.title.trim() : '';
      return title.length > 60 ? `${title.slice(0, 60)}…` : title;
    }
    if (name === 'bash' || name === 'pwsh') {
      const cmd = typeof a.command === 'string' ? a.command.trim() : '';
      const bg = a.background === true ? ' [bg]' : '';
      const base = cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd;
      return `${base}${bg}`;
    }
    if (name.startsWith('bash_session_')) {
      const sid = typeof a.sessionId === 'string' ? a.sessionId.trim() : '';
      const cmd = typeof a.command === 'string' ? a.command.trim() : '';
      const short = cmd.length > 48 ? `${cmd.slice(0, 48)}…` : cmd;
      return [sid, short].filter(Boolean).join(' · ');
    }
    if (name.startsWith('job_')) {
      const id = typeof a.jobId === 'string' ? a.jobId.trim() : '';
      return id;
    }
    if (name.startsWith('schedule_')) {
      const text = typeof a.text === 'string' ? a.text.trim() : '';
      const id = typeof a.id === 'string' ? a.id.trim() : '';
      const due = typeof a.dueAt === 'string' ? a.dueAt.trim() : '';
      const delay =
        typeof a.delayMinutes === 'number' && Number.isFinite(a.delayMinutes)
          ? `+${a.delayMinutes}m`
          : '';
      return [text, id, due || delay].filter(Boolean).join(' · ');
    }
    if (
      name === 'list_agents' ||
      name === 'spawn_subagent' ||
      name === 'fork_subagent' ||
      name.startsWith('subagent_')
    ) {
      const agent = typeof a.agent === 'string' ? a.agent.trim() : '';
      const prompt = typeof a.prompt === 'string' ? a.prompt.trim() : '';
      const id = typeof a.id === 'string' ? a.id.trim() : '';
      const short = prompt.length > 48 ? `${prompt.slice(0, 48)}…` : prompt;
      return [name === 'fork_subagent' ? 'fork' : '', agent, id, short].filter(Boolean).join(' · ');
    }
    if (name === 'workflow') {
      const meta = a.meta as { name?: unknown } | undefined;
      const wn = typeof meta?.name === 'string' ? meta.name.trim() : '';
      return wn || 'workflow';
    }
    if (name === 'fs_glob' || name === 'fs_grep') {
      const pat = typeof a.pattern === 'string' ? a.pattern.trim() : '';
      const p = typeof a.path === 'string' ? a.path.trim() : '';
      return [pat, p].filter(Boolean).join(' @ ') || pat;
    }
    if (typeof a.path === 'string' && a.path.trim()) return a.path.trim();
    if (typeof a.query === 'string' && a.query.trim()) return a.query.trim();
  } catch {
    // ignore
  }
  return '';
}

/** 思考中：取最近一段首行作摘要（仿 dsh ReasoningRow） */
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
/** 发送：向上箭头（圆钮内光学居中） */
const SendIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}>
    <path d="m5 12 7-7 7 7" />
    <path d="M12 19V5" />
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
function WorkspaceMoreMenu({
  open,
  onToggle,
  onRename,
  onDelete,
}: {
  open: boolean;
  onToggle: () => void;
  onRename: () => void;
  onDelete?: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        title="更多"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="w-6 h-6 flex items-center justify-center rounded text-[color:var(--tw-label-tertiary)] hover:text-[color:var(--tw-label-primary)] hover:bg-[color:var(--tw-session-hover-bg)]"
      >
        <EllipsisIcon className="w-3.5 h-3.5" />
      </button>
      <RailMenuPortal open={open} anchorRef={btnRef} dataAttr="data-ws-menu">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-stone-700 hover:bg-stone-50"
          onClick={(e) => {
            e.stopPropagation();
            onRename();
          }}
        >
          <Svg className="w-3.5 h-3.5">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </Svg>
          重命名
        </button>
        {onDelete ? (
          <button
            type="button"
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[13px] text-red-600 hover:bg-red-50"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Svg className="w-3.5 h-3.5">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
            </Svg>
            删除工作区
          </button>
        ) : null}
      </RailMenuPortal>
    </div>
  );
}

/** 侧栏「…」菜单：portal 到 body，避免被 overflow 裁切 */
function RailMenuPortal({
  open,
  anchorRef,
  dataAttr,
  children,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  dataAttr: 'data-session-menu' | 'data-ws-menu';
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const menuW = 160;
      const openUp = r.bottom + 200 > window.innerHeight - 8;
      // dsh：菜单锚在按钮左缘下方，向右展开（可跨出侧栏）
      const left = Math.max(8, Math.min(r.left, window.innerWidth - menuW - 8));
      setPos({
        top: openUp ? r.top - 4 : r.bottom + 4,
        left,
        openUp,
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, anchorRef]);

  if (!open || !pos || typeof document === 'undefined') return null;

  const attrs = { [dataAttr]: '' } as Record<string, string>;
  return createPortal(
    <div
      {...attrs}
      className="tw-popover tw-popover-anim z-[80] w-40 rounded-xl border border-stone-200 py-1 shadow-lg"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        transform: pos.openUp ? 'translateY(-100%)' : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

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
  const menuBtnRef = useRef<HTMLButtonElement>(null);
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
            ref={menuBtnRef}
            type="button"
            title="更多"
            onClick={onToggleMenu}
            className="tw-session-action-btn w-6 h-6 flex items-center justify-center rounded"
          >
            <EllipsisIcon className="w-3.5 h-3.5" />
          </button>
          <RailMenuPortal open={menuOpen} anchorRef={menuBtnRef} dataAttr="data-session-menu">
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
                {/* 仅已归档可删，且为永久删除 */}
                {s.archived ? (
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
                    永久删除
                  </button>
                ) : null}
              </>
            )}
          </RailMenuPortal>
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
      className="tw-icon-btn tw-msg-action-btn inline-flex items-center justify-center rounded-md transition-colors"
    >
      {copied ? (
        <CheckIcon className="w-3.5 h-3.5 text-emerald-600" />
      ) : (
        <CopyIcon className="w-3.5 h-3.5" />
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
      ? `tw-msg-action-meta inline-flex items-center gap-1 tabular-nums transition-colors ${
          open ? 'text-stone-600' : 'text-stone-400 hover:text-stone-600'
        }`
      : `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-colors ${
          open ? 'bg-stone-200/70 text-stone-600' : 'hover:bg-stone-200/60 hover:text-stone-600'
        }`;
  return (
    <span ref={rootRef} className="relative inline-flex items-center">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
        className={btnCls}
      >
        {icon}
        <span className="leading-none">{label}</span>
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
      icon={<DatabaseIcon className="w-3.5 h-3.5 shrink-0" />}
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
        className={`flex items-center gap-1 h-7 pl-2 pr-1 text-[13px] leading-5 font-medium rounded-md outline-none focus:outline-none focus-visible:outline-none transition-colors ${
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
        <div className="tw-popover tw-popover-anim absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-stone-200 p-1 shadow-xl z-50">
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
            <div className="tw-popover tw-popover-anim absolute right-full bottom-0 mr-1.5 w-64 max-h-72 overflow-y-auto rounded-xl border border-stone-200 p-1 shadow-xl">
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
            <div className="tw-popover tw-popover-anim absolute right-full bottom-0 mr-1.5 w-60 rounded-xl border border-stone-200 p-1 shadow-xl">
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
  /** 永久删除确认（仅已归档） */
  const [purgeSessionId, setPurgeSessionId] = useState<string | null>(null);
  const [wsMenuId, setWsMenuId] = useState<string | null>(null);
  const [wsDeleteTarget, setWsDeleteTarget] = useState<WorkspaceItem | null>(null);
  const [wsRenameId, setWsRenameId] = useState<string | null>(null);
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
  const [bashHealth, setBashHealth] = useState<BashHealth | null>(null);
  const [pwshHealth, setPwshHealth] = useState<PwshHealth | null>(null);
  const [webHealth, setWebHealth] = useState<WebHealth | null>(null);
  const [workspaceInfo, setWorkspaceInfo] = useState<WorkspaceInfo | null>(null);
  const [wsBusy, setWsBusy] = useState(false);
  /** 工作区树：展开的文件夹 path、搜索、添加输入框 */
  const [wsExpanded, setWsExpanded] = useState<Record<string, boolean>>({});
  const [wsQuery, setWsQuery] = useState('');
  const [wsSearchOpen, setWsSearchOpen] = useState(false);
  /** 会话行「…」菜单当前打开的 session id */
  const [sessionMenuId, setSessionMenuId] = useState<string | null>(null);
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
  /** 繁忙时排队（dsh QueueDock：展示 + 上一轮结束后自动续发） */
  const [sendQueue, setSendQueue] = useState<
    Array<{
      id: string;
      content: string;
      files: Attachment[];
      refs: DocRef[];
      imgs: ImageAtt[];
    }>
  >([]);
  /** 「@」工作区文件缓存 */
  const [wsAtEntries, setWsAtEntries] = useState<WorkspaceFlatEntry[]>([]);
  const memoryLive = Boolean(pluginOn.memory && memoryHealth?.ok);
  const knowledgeOn = Boolean(pluginOn.knowledge);
  /** 网页能力已升格为会话内置，不再走扩展插件开关 */
  const webLive = Boolean(webHealth?.ok);
  const fsLive = Boolean(fsHealth?.ok);
  const bashLive = Boolean(bashHealth?.ok);
  const pwshLive = Boolean(pwshHealth?.ok && pwshHealth.available);
  const abortRef = useRef<AbortController | null>(null);
  /** time-context 上次完整注入时间（节流 10 分钟） */
  const timeInjectAtRef = useRef<number | null>(null);
  const streamingRef = useRef(false);
  /** ask_user_question：等待用户作答 */
  const askUserWaitRef = useRef<{
    resolve: (s: string) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const planWaitRef = useRef<{
    resolve: (s: string) => void;
    reject: (e: Error) => void;
  } | null>(null);
  const [sessionTodos, setSessionTodos] = useState<TodoItem[]>([]);
  const [sessionGoal, setSessionGoal] = useState<SessionGoal | null>(null);
  const [planPhase, setPlanPhase] = useState<PlanPhase>('off');
  const [planProposal, setPlanProposal] = useState<PlanProposal | null>(null);
  const [askUserPrompt, setAskUserPrompt] = useState<AskUserQuestion[] | null>(null);
  const [askUserDraft, setAskUserDraft] = useState<
    Record<string, { selected: string[]; text: string }>
  >({});
  type PendingSend = {
    id: string;
    content: string;
    files: Attachment[];
    refs: DocRef[];
    imgs: ImageAtt[];
  };
  const sendQueueRef = useRef<PendingSend[]>([]);
  const interruptPayloadRef = useRef<PendingSend | null>(null);

  function syncSendQueue(next: PendingSend[]) {
    sendQueueRef.current = next;
    setSendQueue(next);
  }

  function queueTitle(p: PendingSend): string {
    const t = p.content.trim().replace(/\s+/g, ' ');
    if (t) return t.length > 28 ? `${t.slice(0, 28)}…` : t;
    const n = p.files.length + p.imgs.length + p.refs.length;
    return n > 0 ? `附件 ${n} 项` : '（空消息）';
  }
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
      category: shortWorkspaceLabel(workspaceInfo?.workspace, workspaceInfo?.projectRoot),
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
  const workspaceInfoRef = useRef<WorkspaceInfo | null>(null);
  const messagesRef = useRef<LocalMessage[]>([]);
  messagesRef.current = messages;
  workspaceInfoRef.current = workspaceInfo;

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
      setSessionTodos(normalizeTodos(active?.todos));
      setSessionGoal(normalizeGoal(active?.goal));
      if (active?.workspacePath) {
        setWsExpanded((prev) => ({ ...prev, [active.workspacePath!]: true }));
      }
      setChatTab('dialog');
      setReady(true);

      try {
        const u = new URL(window.location.href);
        const pluginQ = u.searchParams.get('plugin');
        if (pluginQ === 'promptGen' || pluginQ === 'knowledgeGen' || pluginQ === 'caseGen') {
          const id = pluginQ as PluginId;
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
      void fetchBashHealth().then((h) => setBashHealth(h));
      void fetchPwshHealth().then((h) => setPwshHealth(h));
      void fetchWebHealth().then((h) => setWebHealth(h));
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

  /** tool-schedule：页面打开时轮询到期提醒并投递回原会话 */
  useEffect(() => {
    if (!ready) return;
    const deliver = () => {
      const due = claimDueSchedules();
      if (!due.length || !storeRef.current) return;
      let next = storeRef.current;
      let activeTouched = false;
      for (const r of due) {
        const msg: LocalMessage = {
          role: 'assistant',
          content: `⏰ 定时提醒：${r.text}`,
          time: Date.now(),
        };
        next = appendSessionMessage(next, r.sessionId, msg);
        if (r.sessionId === next.activeId) activeTouched = true;
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('TestBench 定时提醒', { body: r.text });
          }
        } catch {
          // ignore
        }
      }
      commitStore(next);
      if (activeTouched) {
        const active = next.sessions.find((s) => s.id === next.activeId);
        setMessages((active?.messages as LocalMessage[]) ?? []);
      }
    };
    deliver();
    const timer = window.setInterval(deliver, 10_000);
    return () => window.clearInterval(timer);
  }, [ready]);

  /** 当前会话切换时，输入栏 / FS 跟会话归属工作区对齐 */
  useEffect(() => {
    if (!ready || !fsLive || !workspaceInfo) return;
    const s = store?.sessions.find((x) => x.id === store.activeId);
    void syncFsWorkspaceForSession(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随会话与工作区列表变化同步
  }, [ready, fsLive, store?.activeId, workspaceInfo?.items]);

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
    void fetchBashHealth().then((h) => setBashHealth(h));
    void fetchPwshHealth().then((h) => setPwshHealth(h));
    void fetchWebHealth().then((h) => setWebHealth(h));
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

  /**
   * 会话在侧栏的「有效工作区」：有合法归属用归属路径，否则用项目根
   * （与 sessionsForWorkspace 挂靠规则一致）。
   */
  function effectiveWorkspacePathForSession(session: ChatSession | undefined): string | null {
    const info = workspaceInfoRef.current;
    if (!info) return null;
    const bound = session?.workspacePath?.trim();
    if (bound && info.items.some((i) => i.path === bound)) return bound;
    return info.projectRoot?.trim() || null;
  }

  /**
   * 切换会话时：把 FS / 输入栏 picker 对齐到该会话的有效工作区。
   * 手动改过 picker 后不要在发送时再调这个（发送以 picker 当前值为准）。
   */
  async function syncFsWorkspaceForSession(session: ChatSession | undefined) {
    if (!fsLive || wsBusy) return;
    const target = effectiveWorkspacePathForSession(session);
    if (!target) return;
    const info = workspaceInfoRef.current;
    if (!info || target === info.workspace) return;
    setWsBusy(true);
    try {
      const next = await selectWorkspace(target);
      syncWorkspaceInfo(next);
    } catch {
      // 静默，不打断对话
    } finally {
      setWsBusy(false);
    }
  }

  /** dsh 输入栏 picker：切换当前工作区；无归属的空会话顺带归入该工作区 */
  async function pickComposerWorkspace(item: WorkspaceItem) {
    if (!fsLive || wsBusy) return;
    await applyWorkspace(item.path, 'select');
    const cur = storeRef.current;
    if (!cur) return;
    const s = cur.sessions.find((x) => x.id === cur.activeId);
    if (!s || s.workspacePath) return;
    const msgs = (s.messages as LocalMessage[] | undefined) ?? [];
    if (msgs.length > 0) return;
    commitStore(bindSessionWorkspace(cur, s.id, item.path));
    setWsExpanded((prev) => ({ ...prev, [item.path]: true }));
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
      if (info.projectRoot) {
        setWsExpanded((prev) => ({ ...prev, [info.projectRoot]: true }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWsBusy(false);
    }
  }

  function requestDropWorkspace(item: WorkspaceItem) {
    if (!fsLive || wsBusy || item.id === 'ws_project') return;
    setSessionMenuId(null);
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
    const active = storeRef.current.sessions.find((s) => s.id === storeRef.current!.activeId);
    const prev = (active?.messages as unknown[]) ?? [];
    // 切会话只是把已存消息灌进 state：内容未变则不碰 updatedAt，避免侧栏重排
    const changed = JSON.stringify(prev) !== JSON.stringify(messages);
    const next = updateActiveMessages(storeRef.current, messages, {
      touchUpdatedAt: changed,
    });
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

  function toCompactable(list: LocalMessage[]): CompactableMessage[] {
    return list
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : '',
        reasoning: m.reasoning,
      }));
  }

  async function runSessionCompact(opts: { force: boolean; signal?: AbortSignal }) {
    if (!settings) {
      openSettings('model');
      return false;
    }
    const src = toCompactable(messagesRef.current);
    if (src.length < 4) {
      setError('对话轮次较少，无需压缩');
      return false;
    }
    setToolHint('正在压缩上下文…');
    try {
      const { messages: compacted, compacted: did } = await compactMessageList(settings, src, {
        force: opts.force,
        signal: opts.signal,
      });
      if (!did) {
        setToolHint(null);
        setError('当前上下文未超过阈值，未压缩');
        return false;
      }
      const now = Date.now();
      const nextLocal: LocalMessage[] = compacted.map((m, i) => ({
        role: m.role,
        content: m.content,
        reasoning: m.reasoning,
        time: now + i,
      }));
      messagesRef.current = nextLocal;
      setMessages(nextLocal);
      if (storeRef.current) {
        commitStore(updateActiveMessages(storeRef.current, nextLocal, { touchUpdatedAt: true }));
      }
      setToolHint(null);
      return true;
    } catch (e) {
      setToolHint(null);
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
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

    // command-compact：/compact 手动压缩（与 compaction-basic 同管线）
    if (isCompactCommand(content) && !files.length && !refs.length && !imgs.length) {
      if (streamingRef.current) {
        setError('请等待当前回复结束后再压缩');
        return;
      }
      if (fromComposer) clearComposer();
      const ok = await runSessionCompact({ force: true });
      if (ok) setError(null);
      return;
    }

    // command-goal：/goal [set …|clear|done]
    if (isGoalCommand(content) && !files.length && !refs.length && !imgs.length) {
      const cmd = parseGoalCommand(content);
      if (fromComposer) clearComposer();
      if (!cmd) return;
      if (cmd.kind === 'show') {
        const g = sessionGoal;
        setError(
          g && g.status !== 'cleared'
            ? `当前目标（${g.status}）：${g.text}`
            : '当前无会话目标。可用 /goal set <内容> 设定',
        );
        return;
      }
      if (cmd.kind === 'clear') {
        setSessionGoal(null);
        if (storeRef.current) {
          commitStore(updateActiveSessionMeta(storeRef.current, { goal: undefined }));
        }
        setError('已清除会话目标');
        return;
      }
      if (cmd.kind === 'done') {
        if (!sessionGoal?.text) {
          setError('当前无目标可标记完成');
          return;
        }
        const nextGoal: SessionGoal = {
          ...sessionGoal,
          status: 'done',
          updatedAt: Date.now(),
        };
        setSessionGoal(nextGoal);
        if (storeRef.current) {
          commitStore(updateActiveSessionMeta(storeRef.current, { goal: nextGoal }));
        }
        setError(`已标记目标完成：${nextGoal.text}`);
        return;
      }
      if (cmd.kind === 'set' && cmd.text) {
        const nextGoal: SessionGoal = {
          text: cmd.text.slice(0, 500),
          status: 'active',
          updatedAt: Date.now(),
        };
        setSessionGoal(nextGoal);
        if (storeRef.current) {
          commitStore(updateActiveSessionMeta(storeRef.current, { goal: nextGoal }));
        }
        setError(`已设定目标：${nextGoal.text}`);
        return;
      }
      return;
    }

    const prepared: PendingSend = {
      id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      content,
      files: [...files],
      refs: [...refs],
      imgs: [...imgs],
    };

    if (streamingRef.current) {
      const primary = loadGeneralPrefs().busySendBehavior ?? 'queue';
      const action = opts?.forceBusy ?? primary;
      if (action === 'queue') {
        syncSendQueue([...sendQueueRef.current, prepared]);
        if (fromComposer) clearComposer();
        return;
      }
      // 插话：中断当前轮，结束后立刻发这条，其后仍按队列自主续发
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
    let next: LocalMessage[] = [...hist, userMsg];

    // compaction-basic：上下文过大时自动压缩（保留最近轮次 + 摘要）
    if (needsAutoCompact(toCompactable(next), settings.model)) {
      setToolHint('上下文较长，正在压缩…');
      try {
        const { messages: compacted, compacted: did } = await compactMessageList(
          settings,
          toCompactable(next),
          { force: false, signal: undefined },
        );
        if (did) {
          const t0 = Date.now();
          next = compacted.map((m, i) => ({
            role: m.role,
            content: m.content,
            reasoning: m.reasoning,
            time: t0 + i,
          }));
          // 确保最新用户消息仍在末尾（compact 已含 recent+user）
          messagesRef.current = next;
          setMessages(next);
          if (storeRef.current) {
            commitStore(updateActiveMessages(storeRef.current, next, { touchUpdatedAt: true }));
          }
        }
      } catch {
        // 压缩失败不阻断发送
      }
      setToolHint(null);
    }

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
    const useWeb = webLive;
    const planGatesWrites = planPhase === 'planning';
    const effectiveAccess = planGatesWrites ? 'readonly' : access;
    const useBash = bashLive && effectiveAccess !== 'readonly';
    const usePwsh = pwshLive && effectiveAccess !== 'readonly';
    // 输入以 picker / FS 当前工作区为准（可手动切到会话归属以外的目录）
    const effectiveFsRoot = workspaceInfoRef.current?.workspace?.trim() || '';
    const fsHintExtra = effectiveFsRoot ? `\n当前工作区：${effectiveFsRoot}` : '';
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
    const memCwd = effectiveFsRoot;
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
    // 会话注入：time-context（纯前端）+ agent-instructions（本地 fs）
    if (!structuredPlugin) {
      const prevUser = [...next]
        .reverse()
        .find((m) => m.role === 'user' && m !== next[next.length - 1]);
      const lastUserAt =
        prevUser?.time ?? [...next].reverse().find((m) => m.role === 'user')?.time ?? null;
      const timeCtx = formatTimeContext({
        lastUserMessageAt: lastUserAt,
        lastInjectAt: timeInjectAtRef.current,
      });
      if (timeCtx.injected) timeInjectAtRef.current = timeCtx.at;
      baseSystem = `${baseSystem}\n\n${timeCtx.text}`;

      if (useFs) {
        try {
          const instr = await fetchAgentInstructions();
          if (instr?.text) {
            baseSystem = `${baseSystem}\n\n${AGENT_INSTRUCTIONS_HINT_PREFIX}\n\n${instr.text}`;
          }
        } catch {
          // 静默跳过
        }
      }
    }

    let payload = buildPluginMessages(baseSystem, apiMessages, {
      memory: useMemory && !structuredPlugin,
      knowledge: useKnowledge && !structuredPlugin,
      fs: useFs && !structuredPlugin,
      web: useWeb && !structuredPlugin,
      bash: useBash && !structuredPlugin,
      pwsh: usePwsh && !structuredPlugin,
      interact: !structuredPlugin,
      planPhase: structuredPlugin ? 'off' : planPhase,
      goalEnabled: !structuredPlugin,
      goal: sessionGoal,
      scheduleEnabled: !structuredPlugin,
      subagentEnabled: !structuredPlugin,
      workflowEnabled: !structuredPlugin,
    }).map((m, i) =>
      i === 0 && m.role === 'system' && useFs && fsHintExtra && !structuredPlugin
        ? { ...m, content: `${typeof m.content === 'string' ? m.content : ''}${fsHintExtra}` }
        : m,
    );

    // 五轨快照注入：超时/失败则跳过，不阻塞发送（结构化插件模式跳过）
    // FS 工作区已由会话切换同步或输入栏手动选择决定，发送时不再拉回会话归属
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
      if (useFs) {
        tools.push(...(fsToolsForAccess(effectiveAccess) as unknown as ToolDef[]));
        if (!planGatesWrites) tools.push(PRESENT_TOOL as unknown as ToolDef);
      }
      if (useBash) {
        tools.push(BASH_TOOL as unknown as ToolDef);
        tools.push(...(BASH_SESSION_TOOLS as unknown as ToolDef[]));
      }
      if (usePwsh) tools.push(PWSH_TOOL as unknown as ToolDef);
      if (useBash || usePwsh) tools.push(...(JOB_TOOLS as unknown as ToolDef[]));
      if (useWeb) tools.push(...(WEB_TOOLS as unknown as ToolDef[]));
      if (useMemory) tools.push(...(MEMORY_TOOLS as unknown as ToolDef[]));
      tools.push(TODO_WRITE_TOOL as unknown as ToolDef);
      tools.push(ASK_USER_QUESTION_TOOL as unknown as ToolDef);
      tools.push(...(GOAL_TOOLS as unknown as ToolDef[]));
      tools.push(...(SCHEDULE_TOOLS as unknown as ToolDef[]));
      tools.push(...(SUBAGENT_TOOLS as unknown as ToolDef[]));
      tools.push(...(WORKFLOW_TOOLS as unknown as ToolDef[]));
      if (planPhase === 'planning' || planPhase === 'approved') {
        tools.push(SUBMIT_PLAN_TOOL as unknown as ToolDef);
      }
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
                if (name.startsWith('fs_')) return await runFsTool(name, args, effectiveAccess);
                if (name === 'present') {
                  if (planGatesWrites) {
                    return JSON.stringify({ error: '计划模式探查中：请先 submit_plan 并等待批准' });
                  }
                  const raw = await runPresentTool(args, effectiveAccess);
                  try {
                    const parsed = JSON.parse(raw) as {
                      ok?: boolean;
                      files?: PresentFile[];
                    };
                    if (parsed.ok && parsed.files?.length) {
                      updateLastAssistant((m) => {
                        const prev = m.presentFiles ?? [];
                        const byPath = new Map(prev.map((f) => [f.path, f]));
                        for (const f of parsed.files!) byPath.set(f.path, f);
                        return { ...m, presentFiles: [...byPath.values()] };
                      });
                    }
                  } catch {
                    // ignore parse for UI; tool result still returned to model
                  }
                  return raw;
                }
                if (name === 'todo_write') {
                  let rawTodos: unknown;
                  try {
                    rawTodos = (JSON.parse(args || '{}') as { todos?: unknown }).todos;
                  } catch {
                    return JSON.stringify({ error: 'invalid JSON arguments' });
                  }
                  const todos = normalizeTodos(rawTodos);
                  setSessionTodos(todos);
                  if (storeRef.current) {
                    commitStore(updateActiveSessionMeta(storeRef.current, { todos }));
                  }
                  return JSON.stringify({ ok: true, count: todos.length, todos });
                }
                if (name.startsWith('goal_')) {
                  if (name === 'goal_get') {
                    return formatGoalForModel(sessionGoal);
                  }
                  if (name === 'goal_set') {
                    let text = '';
                    try {
                      text = String(
                        (JSON.parse(args || '{}') as { text?: unknown }).text ?? '',
                      ).trim();
                    } catch {
                      return JSON.stringify({ error: 'invalid JSON arguments' });
                    }
                    if (!text) return JSON.stringify({ error: 'text is required' });
                    const nextGoal: SessionGoal = {
                      text: text.slice(0, 500),
                      status: 'active',
                      updatedAt: Date.now(),
                    };
                    setSessionGoal(nextGoal);
                    if (storeRef.current) {
                      commitStore(updateActiveSessionMeta(storeRef.current, { goal: nextGoal }));
                    }
                    return formatGoalForModel(nextGoal);
                  }
                  if (name === 'goal_done') {
                    if (!sessionGoal?.text) {
                      return JSON.stringify({ ok: false, error: 'no goal to complete' });
                    }
                    const nextGoal: SessionGoal = {
                      ...sessionGoal,
                      status: 'done',
                      updatedAt: Date.now(),
                    };
                    setSessionGoal(nextGoal);
                    if (storeRef.current) {
                      commitStore(updateActiveSessionMeta(storeRef.current, { goal: nextGoal }));
                    }
                    return formatGoalForModel(nextGoal);
                  }
                  if (name === 'goal_clear') {
                    setSessionGoal(null);
                    if (storeRef.current) {
                      commitStore(updateActiveSessionMeta(storeRef.current, { goal: undefined }));
                    }
                    return JSON.stringify({ ok: true, goal: null });
                  }
                  return JSON.stringify({ error: `unknown tool: ${name}` });
                }
                if (name.startsWith('schedule_')) {
                  const sid = storeRef.current?.activeId ?? '';
                  return await runScheduleTool(name, args, sid);
                }
                if (
                  name === 'list_agents' ||
                  name === 'spawn_subagent' ||
                  name === 'fork_subagent' ||
                  name.startsWith('subagent_')
                ) {
                  return await runSubagentTool(name, args, {
                    settings,
                    parentSignal: ctrl.signal,
                    access: effectiveAccess,
                    fsEnabled: useFs,
                    webEnabled: useWeb,
                    parentMessages: apiMessages,
                    onHint: (text) => setToolHint(text),
                    runFs: (n, a, acc) => runFsTool(n, a, acc),
                    runWeb: (n, a) => runWebTool(n, a),
                  });
                }
                if (name === 'workflow') {
                  return await runWorkflowTool(name, args, {
                    settings,
                    parentSignal: ctrl.signal,
                    access: effectiveAccess,
                    fsEnabled: useFs,
                    webEnabled: useWeb,
                    parentMessages: apiMessages,
                    onHint: (text) => setToolHint(text),
                    runFs: (n, a, acc) => runFsTool(n, a, acc),
                    runWeb: (n, a) => runWebTool(n, a),
                  });
                }
                if (name === 'ask_user_question') {
                  const questions = parseAskUserArgs(args);
                  if (!questions.length) {
                    return JSON.stringify({ error: 'questions is required' });
                  }
                  const draft: Record<string, { selected: string[]; text: string }> = {};
                  for (const q of questions) draft[q.id] = { selected: [], text: '' };
                  setAskUserDraft(draft);
                  setAskUserPrompt(questions);
                  return await new Promise<string>((resolve, reject) => {
                    askUserWaitRef.current = { resolve, reject };
                    const ac = abortRef.current;
                    const onAbort = () => {
                      ac?.signal.removeEventListener('abort', onAbort);
                      settleAskUserCanceled();
                    };
                    ac?.signal.addEventListener('abort', onAbort);
                  });
                }
                if (name === 'submit_plan') {
                  const plan = parseSubmitPlanArgs(args);
                  if (!plan) {
                    return JSON.stringify({ error: 'title and steps are required' });
                  }
                  setPlanProposal(plan);
                  return await new Promise<string>((resolve, reject) => {
                    planWaitRef.current = { resolve, reject };
                    const ac = abortRef.current;
                    const onAbort = () => {
                      ac?.signal.removeEventListener('abort', onAbort);
                      settlePlanCanceled();
                    };
                    ac?.signal.addEventListener('abort', onAbort);
                  });
                }
                if (name === 'bash') return await runBashTool(args, effectiveAccess);
                if (name === 'pwsh') return await runPwshTool(args, effectiveAccess);
                if (name.startsWith('bash_session_')) {
                  return await runBashSessionTool(name, args, effectiveAccess);
                }
                if (name.startsWith('job_')) return await runJobTool(name, args, effectiveAccess);
                if (name.startsWith('web_')) return await runWebTool(name, args);
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
          const detail = toolArgsDetail(chunk.name, chunk.args);
          const stepId = `tool_${chunk.name}_${chunk.args?.slice(0, 24) ?? ''}`;
          updateLastAssistant((m) => {
            const steps = [...(m.activitySteps ?? [])];
            const idx = steps.findIndex(
              (s) =>
                s.id === stepId ||
                (s.detail === detail && s.title === kind && s.status === 'running'),
            );
            const next: ActivityStep = {
              id: stepId,
              kind: activityKindForTool(chunk.name),
              title: kind,
              detail: detail || undefined,
              status: chunk.status === 'running' ? 'running' : 'done',
            };
            if (idx >= 0) steps[idx] = { ...steps[idx], ...next };
            else steps.push(next);
            return { ...m, activitySteps: steps };
          });
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
          const nextMsg: LocalMessage =
            chunk.type === 'reasoning'
              ? { ...last, reasoning: (last.reasoning ?? '') + chunk.delta }
              : { ...last, content: last.content + chunk.delta };
          if (chunk.type === 'reasoning') {
            const steps = [...(nextMsg.activitySteps ?? [])];
            const thinkIdx = steps.findIndex((s) => s.kind === 'thinking');
            const thinkStep: ActivityStep = {
              id: 'thinking',
              kind: 'thinking',
              title: '思考',
              status: 'running',
            };
            if (thinkIdx >= 0) steps[thinkIdx] = { ...steps[thinkIdx], ...thinkStep };
            else steps.unshift(thinkStep);
            nextMsg.activitySteps = steps;
          }
          if (settle) {
            nextMsg.reasoningDuration = Math.max(
              1,
              Math.round((Date.now() - reasoningStartTs) / 1000),
            );
            const steps = [...(nextMsg.activitySteps ?? [])];
            const thinkIdx = steps.findIndex((s) => s.kind === 'thinking');
            if (thinkIdx >= 0) steps[thinkIdx] = { ...steps[thinkIdx], status: 'done' };
            nextMsg.activitySteps = steps;
          }
          return nextMsg;
        });
      }
      turnOk = true;
      // 流结束：结算思考耗时，并把 thinking 步骤标为 done
      {
        const duration =
          reasoningStartTs > 0 && !reasoningSettled
            ? Math.max(1, Math.round((Date.now() - reasoningStartTs) / 1000))
            : null;
        updateLastAssistant((m) => {
          const steps = (m.activitySteps ?? []).map((s) =>
            s.kind === 'thinking' && s.status === 'running' ? { ...s, status: 'done' as const } : s,
          );
          const next: LocalMessage = { ...m, activitySteps: steps };
          if (duration != null && m.reasoning && m.reasoningDuration == null) {
            next.reasoningDuration = duration;
          }
          return next;
        });
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

      // dsh：当前轮结束后自主取下一条（插话优先，否则队列头）
      let followUp = interruptPayloadRef.current;
      interruptPayloadRef.current = null;
      if (!followUp && sendQueueRef.current.length) {
        followUp = sendQueueRef.current[0];
        syncSendQueue(sendQueueRef.current.slice(1));
      }
      if (followUp) {
        window.setTimeout(() => {
          void executeSend(followUp!);
        }, 0);
      }
    }
  }

  function stop() {
    // 手动停止：清空插话与排队，不自动续发
    interruptPayloadRef.current = null;
    syncSendQueue([]);
    abortRef.current?.abort();
  }

  function removeQueued(id: string) {
    syncSendQueue(sendQueueRef.current.filter((q) => q.id !== id));
  }

  function editQueued(id: string) {
    const item = sendQueueRef.current.find((q) => q.id === id);
    if (!item) return;
    removeQueued(id);
    setInput(item.content);
    setAttachments(item.files);
    setImages(item.imgs);
    setDocRefs(item.refs);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  /** 插话：打断当前轮，优先发送该条，其余排队仍会在结束后自主续发 */
  function promoteQueued(id: string) {
    const item = sendQueueRef.current.find((q) => q.id === id);
    if (!item) return;
    syncSendQueue(sendQueueRef.current.filter((q) => q.id !== id));
    if (!streamingRef.current) {
      void executeSend(item);
      return;
    }
    interruptPayloadRef.current = item;
    abortRef.current?.abort();
  }

  /** Cmd/Ctrl+Enter：插话发送；其余排队在本轮结束后自主续发 */
  function flushQueueAsInterrupt(extra?: PendingSend) {
    const rest = [...sendQueueRef.current];
    const head = extra ?? rest.shift() ?? null;
    if (!head) return;
    syncSendQueue(rest);
    if (!streamingRef.current) {
      void executeSend(head);
      return;
    }
    interruptPayloadRef.current = head;
    abortRef.current?.abort();
  }

  function toggleReasoning(index: number, e: ReactMouseEvent<HTMLButtonElement>) {
    const willOpen = !(messages[index]?.reasoningOpen ?? false);
    setMessages((prev) =>
      prev.map((m, i) => (i === index ? { ...m, reasoningOpen: !m.reasoningOpen } : m)),
    );
    if (willOpen) {
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
    setChatTab('dialog');
    const leavingId = storeRef.current.activeId;
    saveComposerDraft(leavingId);
    resetComposer({ clearDraft: true });
    const base = pruneEphemeralSession(leavingId) ?? storeRef.current;
    // dsh：插件新会话也归入当前 picker 工作区
    const ws = workspaceInfo?.workspace?.trim() || undefined;
    let next = createSession(base, ws ? { workspacePath: ws } : undefined);
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
    const expandPath = ws || workspaceInfo?.projectRoot;
    if (expandPath) setWsExpanded((prev) => ({ ...prev, [expandPath]: true }));
    void syncFsWorkspaceForSession(next.sessions.find((x) => x.id === next.activeId));
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
    setChatTab('dialog');
    const leavingId = storeRef.current.activeId;
    saveComposerDraft(leavingId);
    resetComposer({ clearDraft: true });
    let base = pruneEphemeralSession(leavingId) ?? storeRef.current;
    // dsh：新会话归入「当前工作区」（显式传入 path 优先，否则用 picker 选中项）
    const ws = workspacePath?.trim() || workspaceInfo?.workspace?.trim() || undefined;
    const next = createSession(base, ws ? { workspacePath: ws } : undefined);
    commitStore(next);
    setMessages([]);
    setCaseGenConfig(null);
    setPromptGenConfig(null);
    setKnowledgeGenConfig(null);
    setSessionTodos([]);
    setSessionGoal(null);
    setPlanPhase('off');
    settleAskUserCanceled();
    settlePlanCanceled();
    const expandPath = ws || workspaceInfo?.projectRoot;
    if (expandPath) setWsExpanded((prev) => ({ ...prev, [expandPath]: true }));
    void syncFsWorkspaceForSession(next.sessions.find((x) => x.id === next.activeId));
  }

  function settleAskUserCanceled() {
    const wait = askUserWaitRef.current;
    if (!wait) return;
    askUserWaitRef.current = null;
    setAskUserPrompt(null);
    setAskUserDraft({});
    wait.resolve(JSON.stringify({ canceled: true, error: 'user aborted' }));
  }

  function settlePlanCanceled() {
    const wait = planWaitRef.current;
    if (!wait) return;
    planWaitRef.current = null;
    setPlanProposal(null);
    wait.resolve(JSON.stringify({ approved: false, canceled: true }));
  }

  function approvePlan() {
    const wait = planWaitRef.current;
    if (!wait) return;
    planWaitRef.current = null;
    setPlanProposal(null);
    setPlanPhase('approved');
    wait.resolve(JSON.stringify({ approved: true, message: '用户已批准计划，可以开始实施' }));
  }

  function rejectPlan() {
    const wait = planWaitRef.current;
    if (!wait) return;
    planWaitRef.current = null;
    setPlanProposal(null);
    setPlanPhase('planning');
    wait.resolve(
      JSON.stringify({ approved: false, message: '用户驳回了计划，请修订后再次 submit_plan' }),
    );
  }

  function togglePlanMode() {
    setPlanPhase((cur) => {
      if (cur === 'off') return 'planning';
      settlePlanCanceled();
      return 'off';
    });
  }

  function submitAskUserAnswers() {
    const wait = askUserWaitRef.current;
    const questions = askUserPrompt;
    if (!wait || !questions?.length) return;
    const answers: AskUserAnswer[] = questions.map((q) => {
      const draft = askUserDraft[q.id] ?? { selected: [], text: '' };
      if (q.options?.length) {
        return { id: q.id, selected: draft.selected };
      }
      return { id: q.id, text: draft.text.trim() };
    });
    for (const q of questions) {
      const a = answers.find((x) => x.id === q.id);
      if (q.options?.length) {
        if (!a?.selected?.length) {
          setError('请先选择选项后再提交');
          return;
        }
      } else if (!a?.text?.trim()) {
        setError('请先填写回答后再提交');
        return;
      }
    }
    askUserWaitRef.current = null;
    setAskUserPrompt(null);
    setAskUserDraft({});
    setError(null);
    wait.resolve(JSON.stringify({ answers }));
  }

  function openSession(id: string) {
    if (!storeRef.current) return;
    setChatTab('dialog');
    setSessionMenuId(null);
    if (id === storeRef.current.activeId) return;
    const leavingId = storeRef.current.activeId;
    saveComposerDraft(leavingId);
    abortRef.current?.abort();
    settleAskUserCanceled();
    settlePlanCanceled();
    setPlanPhase('off');
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
    setSessionTodos(normalizeTodos(s?.todos));
    setSessionGoal(normalizeGoal(s?.goal));
    restoreComposerDraft(id);
    commitStore(next);
    void syncFsWorkspaceForSession(s);
  }

  /** 永久删除会话（仅已归档） */
  function purgeSession(id: string) {
    if (!storeRef.current) return;
    setSessionMenuId(null);
    setWsMenuId(null);
    const wasActive = storeRef.current.activeId === id;
    if (wasActive) resetComposer({ clearDraft: true });
    delete composerDraftsRef.current[id];
    const next = deleteSession(storeRef.current, id);
    commitStore(next);
    void deleteSessionMemory(id);
    if (wasActive) {
      const s = next.sessions.find((x) => x.id === next.activeId);
      setMessages((s?.messages as LocalMessage[]) ?? []);
      setCaseGenConfig(s?.caseGen?.active ? s.caseGen : null);
      setPromptGenConfig(s?.promptGen?.active ? s.promptGen : null);
      setKnowledgeGenConfig(s?.knowledgeGen?.active ? s.knowledgeGen : null);
    }
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
    setWsMenuId(null);
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
  const wsItems = workspaceInfo?.items ?? [];
  const wsPaths = new Set(wsItems.map((it) => it.path));
  const wsActivePath = workspaceInfo?.workspace ?? '';
  const projectRootPath = workspaceInfo?.projectRoot ?? '';
  const activeSess = store?.sessions.find((s) => s.id === store.activeId);
  const activeSessWs = activeSess?.workspacePath;
  const activeSessInProjectRoot = !activeSessWs || !wsPaths.has(activeSessWs);
  /** 输入栏 picker：显示 FS 当前工作区（进会话时已对齐归属；手动切换后跟手动值） */
  const composerWsPath = workspaceInfo?.workspace?.trim() || '';
  const composerWsItem = wsItems.find((it) => it.path === composerWsPath);
  const composerWsLabel = composerWsItem
    ? workspaceDisplayName(composerWsItem, projectRootPath)
    : composerWsPath
      ? shortWorkspaceLabel(composerWsPath, projectRootPath)
      : '工作区';
  const qNorm = wsQuery.trim().toLowerCase();
  /** 无归属或路径已不在列表中 → 归入项目根工作区（不再有「未分组」） */
  function sessionsForWorkspace(item: WorkspaceItem): ChatSession[] {
    const isProjectRoot = item.id === 'ws_project' || item.path === projectRootPath;
    return sortSessionsInGroup(
      activeSessions
        .filter((s) => {
          if (s.workspacePath === item.path) return true;
          if (isProjectRoot && (!s.workspacePath || !wsPaths.has(s.workspacePath))) return true;
          return false;
        })
        .filter((s) => !qNorm || s.title.toLowerCase().includes(qNorm)),
    );
  }

  const visibleWsItems = wsItems.filter((it) => {
    if (!qNorm) return true;
    if (it.name.toLowerCase().includes(qNorm) || it.path.toLowerCase().includes(qNorm)) {
      return true;
    }
    return sessionsForWorkspace(it).length > 0;
  });

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
          // 先关菜单，避免确认框底下仍挂着「…」弹层
          setSessionMenuId(null);
          setWsMenuId(null);
          setPurgeSessionId(s.id);
        }}
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
            <a
              href={`${base}plugins/`}
              title="我的插件"
              onClick={() => {
                const leaving = storeRef.current?.activeId;
                const pruned = pruneEphemeralSession(leaving);
                if (pruned && pruned !== storeRef.current) {
                  commitStore(pruned);
                }
              }}
              className="tw-rail-plugin-btn w-full h-9 flex items-center justify-center gap-1.5 text-[13px] font-medium rounded-full transition-colors"
            >
              <PluginIcon className="w-3.5 h-3.5" />
              插件
            </a>
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
            <a
              href={`${base}plugins/`}
              title="我的插件"
              onClick={() => {
                const leaving = storeRef.current?.activeId;
                const pruned = pruneEphemeralSession(leaving);
                if (pruned && pruned !== storeRef.current) {
                  commitStore(pruned);
                }
              }}
              className="tw-rail-plugin-btn tw-rail-plugin-btn--icon w-8 h-8 flex items-center justify-center rounded-lg"
            >
              <PluginIcon className="w-4 h-4" />
            </a>
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
                // 仅当「当前聚焦会话」归属本工作区时才显示文件夹聚焦色（非 FS cwd）
                const isProjectRoot = item.id === 'ws_project' || item.path === projectRootPath;
                const isActiveWs = Boolean(
                  activeSess &&
                  (activeSessInProjectRoot ? isProjectRoot : activeSessWs === item.path),
                );
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
                          <FolderIcon open={expanded} className="w-3.5 h-3.5" />
                        </span>
                        <span className="tw-slot tw-chevron">
                          <TriangleChevron open={expanded} className="w-3 h-3" />
                        </span>
                        <span className="tw-project-title">
                          {workspaceDisplayName(item, projectRootPath)}
                        </span>
                      </button>
                      <div className="tw-ws-actions relative shrink-0" data-ws-menu="">
                        <WorkspaceMoreMenu
                          open={menuOpen}
                          onToggle={() => {
                            setSessionMenuId(null);
                            setWsMenuId(menuOpen ? null : item.id);
                          }}
                          onRename={() => {
                            setSessionMenuId(null);
                            setWsMenuId(null);
                            setWsRenameId(item.id);
                          }}
                          onDelete={
                            item.id !== 'ws_project' ? () => requestDropWorkspace(item) : undefined
                          }
                        />
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
                    <div className={`tw-collapse ${expanded ? 'is-open' : ''}`}>
                      <div className="tw-collapse-inner">
                        {kids.map((s) => (
                          <SessionRow key={s.id} s={s} nested />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
              {!visibleWsItems.length && fsLive && (
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
                  已归档 ({archivedSessions.length})
                </button>
                <div className={`tw-collapse ${showArchived ? 'is-open' : ''}`}>
                  <div className="tw-collapse-inner space-y-0.5">
                    {archivedSessions.map((s) => (
                      <SessionRow key={s.id} s={s} />
                    ))}
                  </div>
                </div>
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
                  {shortWorkspaceLabel(wsActivePath, projectRootPath)}
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
          {sessionGoal && sessionGoal.status !== 'cleared' && chatTab !== 'memory' ? (
            <div className="px-6 pb-2">
              <div className="rounded-xl border border-[#4176e6]/25 bg-[#f5f8ff] px-3 py-2 flex items-start gap-2">
                <span className="text-[11px] font-medium text-[#4176e6] shrink-0 pt-0.5">
                  目标{sessionGoal.status === 'done' ? '·完成' : ''}
                </span>
                <span
                  className={`flex-1 min-w-0 text-[12px] leading-5 ${
                    sessionGoal.status === 'done' ? 'text-stone-400 line-through' : 'text-stone-800'
                  }`}
                >
                  {sessionGoal.text}
                </span>
                <button
                  type="button"
                  title="清除目标"
                  className="text-[11px] text-stone-400 hover:text-stone-600 shrink-0"
                  onClick={() => {
                    setSessionGoal(null);
                    if (storeRef.current) {
                      commitStore(updateActiveSessionMeta(storeRef.current, { goal: undefined }));
                    }
                  }}
                >
                  清除
                </button>
              </div>
            </div>
          ) : null}
          {sessionTodos.length > 0 && chatTab !== 'memory' ? (
            <div className="px-6 pb-3">
              <div className="rounded-xl border border-stone-200 bg-white px-3 py-2.5">
                <div className="text-[11px] font-medium text-stone-500 mb-1.5">
                  待办 · {sessionTodos.filter((x) => x.status === 'completed').length}/
                  {sessionTodos.length}
                </div>
                <ul className="space-y-1 max-h-28 overflow-y-auto">
                  {sessionTodos.map((item, idx) => (
                    <li
                      key={`${idx}-${item.content}`}
                      className="flex items-start gap-2 text-[12px] text-stone-700"
                    >
                      <span
                        className={`mt-0.5 w-3.5 h-3.5 rounded-sm border shrink-0 flex items-center justify-center text-[9px] ${
                          item.status === 'completed'
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : item.status === 'in_progress'
                              ? 'border-[#4176e6] text-[#4176e6]'
                              : 'border-stone-300 text-transparent'
                        }`}
                        aria-hidden
                      >
                        {item.status === 'completed'
                          ? '✓'
                          : item.status === 'in_progress'
                            ? '…'
                            : ''}
                      </span>
                      <span
                        className={item.status === 'completed' ? 'line-through text-stone-400' : ''}
                      >
                        {item.content}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>

        {chatTab === 'memory' && pluginOn.memory ? (
          <div
            key={`memory-${store?.activeId ?? ''}`}
            className="flex-1 min-h-0 bg-[color:var(--tw-surface-page)] tw-pane-enter"
          >
            <MemoryPane
              live={memoryLive}
              pluginOn={Boolean(pluginOn.memory)}
              workspacePath={
                store?.sessions.find((s) => s.id === store.activeId)?.workspacePath ||
                workspaceInfo?.projectRoot ||
                ''
              }
            />
          </div>
        ) : (
          <div
            key={`dialog-${store?.activeId ?? ''}`}
            className="flex-1 min-h-0 flex flex-col tw-pane-enter"
          >
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
                    <img
                      src={`${base}brand-mark.png`}
                      alt=""
                      width={52}
                      height={52}
                      className="w-[52px] h-[52px] rounded-[12px] object-contain"
                    />
                    <h2 className="mt-4 text-base font-medium text-stone-800">
                      {t('chat.emptyTitle', undefined, generalPrefs.language)}
                    </h2>
                    <p className="mt-2 text-sm text-stone-600 max-w-lg leading-relaxed">
                      {t('chat.emptyBenefits', undefined, generalPrefs.language)}
                    </p>
                    {!settings && (
                      <>
                        <p className="mt-2 text-sm text-stone-500 max-w-md">
                          {t('chat.emptyNoModel', undefined, generalPrefs.language)}
                        </p>
                        <button
                          onClick={() => openSettings('model')}
                          className="mt-4 px-4 py-2 text-sm font-medium text-white bg-[#4176e6] rounded-lg hover:bg-[#3565c7] transition-colors"
                        >
                          {t('chat.configureModel', undefined, generalPrefs.language)}
                        </button>
                      </>
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
                          <div className={`tw-msg-actions ${revealCls(i)}`}>
                            {m.time != null && (
                              <span className="tw-msg-action-time pr-0.5">{fmtClock(m.time)}</span>
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
                            const toolSteps = (m.activitySteps ?? []).filter(
                              (s) => s.kind !== 'thinking',
                            );
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
                                      用时 {m.reasoningDuration}s
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
                                {open && toolSteps.length > 0 ? (
                                  <ul className="mt-1 mb-1 pl-[22px] space-y-1">
                                    {toolSteps.map((s) => (
                                      <li
                                        key={s.id}
                                        className="text-[12px] text-stone-500 flex items-baseline gap-2 min-w-0"
                                      >
                                        <span className="shrink-0 text-stone-400">·</span>
                                        <span className="font-medium text-stone-600 shrink-0">
                                          {s.title}
                                        </span>
                                        {s.detail ? (
                                          <span className="truncate" title={s.detail}>
                                            {s.detail}
                                          </span>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
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
                                void openDocsFile(m.docsFile!.root, m.docsFile!.path).catch((e) =>
                                  setError(e instanceof Error ? e.message : String(e)),
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
                          {m.presentFiles?.length
                            ? m.presentFiles.map((pf) => (
                                <button
                                  key={pf.path}
                                  type="button"
                                  title="点击本地打开"
                                  onClick={() => {
                                    void openFsPath(pf.path, access).catch((e) =>
                                      setError(e instanceof Error ? e.message : String(e)),
                                    );
                                  }}
                                  className="mt-3 w-full max-w-md flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left hover:border-[#4176e6] hover:bg-[#f5f8ff] transition-colors cursor-pointer"
                                >
                                  <span className="w-10 h-10 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center text-[10px] font-semibold shrink-0">
                                    {pf.name.split('.').pop()?.toUpperCase() || 'FILE'}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-sm text-stone-800 truncate">
                                      {pf.name}
                                    </span>
                                    <span className="block text-[11px] text-stone-400 truncate">
                                      {pf.path}
                                      {pf.description ? ` · ${pf.description}` : ''}
                                      {' · 点击打开'}
                                    </span>
                                  </span>
                                </button>
                              ))
                            : null}
                          {m.content && !(i === messages.length - 1 && streaming) ? (
                            <div className={`tw-msg-actions mt-1 ${revealCls(i)}`}>
                              <CopyButton text={m.content} />
                              {m.usage && (
                                <TurnUsageButton
                                  usage={m.usage}
                                  model={m.model ?? settings?.model}
                                />
                              )}
                              {m.time != null && (
                                <span className="tw-msg-action-time">{fmtClock(m.time)}</span>
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
                {/* dsh QueueDock：排队条目可见，当前轮结束后自动续发下一条 */}
                {sendQueue.length > 0 ? (
                  <div className="mb-2 rounded-xl border border-stone-200/80 bg-stone-100/80 overflow-hidden">
                    {sendQueue.map((q) => (
                      <div
                        key={q.id}
                        className="flex items-center gap-2 px-3 py-2 border-b border-stone-200/60 last:border-b-0"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0"
                          aria-hidden
                        />
                        <span className="flex-1 min-w-0 truncate text-[13px] text-stone-700">
                          {queueTitle(q)}
                        </span>
                        <button
                          type="button"
                          title="编辑回输入框"
                          onClick={() => editQueued(q.id)}
                          className="tw-icon-btn w-7 h-7 rounded-md flex items-center justify-center outline-none"
                        >
                          <Svg className="w-3.5 h-3.5">
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </Svg>
                        </button>
                        <button
                          type="button"
                          title="从队列移除"
                          onClick={() => removeQueued(q.id)}
                          className="tw-icon-btn w-7 h-7 rounded-md flex items-center justify-center outline-none"
                        >
                          <Svg className="w-3.5 h-3.5">
                            <path d="M3 6h18" />
                            <path d="M8 6V4h8v2" />
                            <path d="M19 6l-1 14H6L5 6" />
                          </Svg>
                        </button>
                        <button
                          type="button"
                          title="插话立即发送（其后队列仍会续发）"
                          onClick={() => promoteQueued(q.id)}
                          className="tw-icon-btn w-7 h-7 rounded-md flex items-center justify-center outline-none text-[#4176e6]"
                        >
                          <SendIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {planProposal ? (
                  <div className="mb-2 rounded-xl border border-amber-300/60 bg-amber-50/90 px-4 py-3 shadow-sm">
                    <div className="text-[13px] font-medium text-stone-800 mb-1">待批准计划</div>
                    <div className="text-[14px] font-medium text-stone-900">
                      {planProposal.title}
                    </div>
                    {planProposal.summary ? (
                      <p className="mt-1 text-[13px] text-stone-600 leading-5">
                        {planProposal.summary}
                      </p>
                    ) : null}
                    <ol className="mt-2 list-decimal pl-5 space-y-1 text-[13px] text-stone-700">
                      {planProposal.steps.map((s, i) => (
                        <li key={`${i}-${s.slice(0, 24)}`}>{s}</li>
                      ))}
                    </ol>
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        className="h-8 px-3 rounded-lg border border-stone-200 bg-white text-[12px] text-stone-600 hover:bg-stone-50"
                        onClick={() => rejectPlan()}
                      >
                        驳回
                      </button>
                      <button
                        type="button"
                        className="h-8 px-3 rounded-lg bg-[#4176e6] text-[12px] text-white hover:bg-[#3467d4]"
                        onClick={() => approvePlan()}
                      >
                        批准实施
                      </button>
                    </div>
                  </div>
                ) : null}
                {askUserPrompt?.length ? (
                  <div className="mb-2 rounded-xl border border-[#4176e6]/30 bg-[#f5f8ff] px-4 py-3 shadow-sm">
                    <div className="text-[13px] font-medium text-stone-800 mb-2">
                      模型需要你的确认
                    </div>
                    <div className="space-y-3">
                      {askUserPrompt.map((q) => {
                        const draft = askUserDraft[q.id] ?? { selected: [], text: '' };
                        return (
                          <div
                            key={q.id}
                            className="rounded-lg border border-stone-200 bg-white p-3"
                          >
                            {q.header ? (
                              <div className="text-[11px] font-medium text-[#4176e6] mb-1">
                                {q.header}
                              </div>
                            ) : null}
                            <div className="text-[13px] text-stone-800 mb-2">{q.question}</div>
                            {q.options?.length ? (
                              <div className="space-y-1.5">
                                {q.options.map((opt) => {
                                  const checked = draft.selected.includes(opt.label);
                                  return (
                                    <label
                                      key={opt.label}
                                      className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 cursor-pointer text-[12px] ${
                                        checked
                                          ? 'border-[#4176e6] bg-[#edf3fe]'
                                          : 'border-stone-200 hover:border-stone-300'
                                      }`}
                                    >
                                      <input
                                        type={q.multi_select ? 'checkbox' : 'radio'}
                                        name={`ask-${q.id}`}
                                        className="mt-0.5"
                                        checked={checked}
                                        onChange={() => {
                                          setAskUserDraft((prev) => {
                                            const cur = prev[q.id] ?? {
                                              selected: [],
                                              text: '',
                                            };
                                            let selected: string[];
                                            if (q.multi_select) {
                                              selected = checked
                                                ? cur.selected.filter((x) => x !== opt.label)
                                                : [...cur.selected, opt.label];
                                            } else {
                                              selected = [opt.label];
                                            }
                                            return {
                                              ...prev,
                                              [q.id]: { ...cur, selected },
                                            };
                                          });
                                        }}
                                      />
                                      <span className="min-w-0">
                                        <span className="block text-stone-800">{opt.label}</span>
                                        {opt.description ? (
                                          <span className="block text-stone-400 mt-0.5">
                                            {opt.description}
                                          </span>
                                        ) : null}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            ) : (
                              <textarea
                                value={draft.text}
                                onChange={(e) =>
                                  setAskUserDraft((prev) => ({
                                    ...prev,
                                    [q.id]: {
                                      selected: [],
                                      text: e.target.value,
                                    },
                                  }))
                                }
                                rows={2}
                                className="w-full rounded-lg border border-stone-200 px-2.5 py-2 text-[13px] outline-none focus:border-[#4176e6]"
                                placeholder="输入你的回答…"
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          abortRef.current?.abort();
                          settleAskUserCanceled();
                        }}
                        className="h-8 px-3 rounded-lg text-[12px] text-stone-600 hover:bg-stone-100"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => submitAskUserAnswers()}
                        className="h-8 px-3 rounded-lg text-[12px] font-medium text-white bg-[#4176e6] hover:bg-[#3566d4]"
                      >
                        提交回答
                      </button>
                    </div>
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
                            {r.collection === 'workspace' ? '工作区' : formatSlashBadge(r.format)}
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
                            onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
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
                        className="tw-composer-menu tw-popover-anim absolute bottom-full left-0 right-0 mb-2 mx-2 z-40 max-h-64 overflow-y-auto rounded-xl border border-stone-200 shadow-xl p-1"
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
                        className="tw-composer-menu tw-popover-anim absolute bottom-full left-0 right-0 mb-2 mx-2 z-40 max-h-64 overflow-y-auto rounded-xl border border-stone-200 shadow-xl p-1"
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
                                项目文档（{docRootLabel('knowledge')} / {docRootLabel('templates')}
                                ）
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
                            if (pluginSlashState) setInput(input.slice(0, pluginSlashState.from));
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
                          const alt = e.metaKey || e.ctrlKey;
                          if (streamingRef.current) {
                            // Cmd/Ctrl+Enter：插话；有队列时带着队列后续自主续发
                            if (alt) {
                              const draft = input.trim();
                              const hasDraft =
                                Boolean(draft) ||
                                attachments.length > 0 ||
                                images.length > 0 ||
                                docRefs.length > 0;
                              if (hasDraft) {
                                const extra: PendingSend = {
                                  id: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                                  content: draft,
                                  files: [...attachments],
                                  refs: [...docRefs],
                                  imgs: [...images],
                                };
                                clearComposer();
                                flushQueueAsInterrupt(extra);
                              } else if (sendQueueRef.current.length) {
                                flushQueueAsInterrupt();
                              }
                              return;
                            }
                            const primary = loadGeneralPrefs().busySendBehavior ?? 'queue';
                            void send(undefined, { forceBusy: primary });
                          } else {
                            void send();
                          }
                        }
                      }}
                      rows={1}
                      placeholder={
                        !settings
                          ? '请先配置模型（右下角「配置模型」或左下角「设置」→ 模型）'
                          : sendQueue.length > 0 && streaming
                            ? 'Cmd/Ctrl+Enter 插话发送全部排队消息'
                            : '请输入内容；/goal 目标；/compact 压缩；/ 插件；@ 文档'
                      }
                      className="tw-chat-input block w-full min-h-[36px] pl-[14px] pr-2 pt-1 pb-0 bg-transparent resize-none focus:outline-none placeholder:text-[color:var(--tw-label-tertiary)]"
                    />
                  </div>

                  <div className="flex items-center gap-1.5 px-3 pb-3 pt-3">
                    {/* 「+」：dsh 风格「添加 → 文件」 */}
                    <Menu>
                      <MenuButton
                        title={
                          planPhase === 'off'
                            ? '添加'
                            : planPhase === 'planning'
                              ? '添加（计划模式·探查中）'
                              : '添加（计划模式·已批准）'
                        }
                        className={`tw-icon-btn w-8 h-8 shrink-0 rounded-full flex items-center justify-center outline-none focus:outline-none focus-visible:outline-none data-[open]:bg-[color:var(--tw-session-hover-bg)] transition-colors ${
                          planPhase === 'planning'
                            ? 'text-amber-700 bg-amber-50'
                            : planPhase === 'approved'
                              ? 'text-emerald-700 bg-emerald-50'
                              : ''
                        }`}
                      >
                        <Svg className="w-4 h-4">
                          <path d="M5 12h14" />
                          <path d="M12 5v14" />
                        </Svg>
                      </MenuButton>
                      <MenuItems
                        transition
                        anchor={{ to: 'top start', gap: 8 }}
                        className="tw-select-menu tw-menu-anim z-50 w-[min(100vw-2rem,20rem)] rounded-xl border border-stone-200 py-1.5 shadow-xl focus:outline-none"
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
                        <div className="my-1 border-t border-stone-100" />
                        <div className="px-3 pt-1 pb-1.5 text-[11px] font-medium text-stone-400 tracking-wide">
                          模式
                        </div>
                        <MenuItem>
                          <button
                            type="button"
                            onClick={() => togglePlanMode()}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left data-[focus]:bg-stone-100"
                          >
                            <span
                              className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center text-[10px] ${
                                planPhase === 'off'
                                  ? 'border-stone-300 text-transparent'
                                  : planPhase === 'planning'
                                    ? 'border-amber-500 bg-amber-50 text-amber-700'
                                    : 'border-emerald-500 bg-emerald-50 text-emerald-700'
                              }`}
                              aria-hidden
                            >
                              {planPhase !== 'off' ? '✓' : ''}
                            </span>
                            <span className="min-w-0 text-[13px] text-stone-800">
                              计划模式
                              <span className="ml-1.5 text-stone-400 font-normal">
                                {planPhase === 'off'
                                  ? '关闭'
                                  : planPhase === 'planning'
                                    ? '探查中'
                                    : '已批准'}
                              </span>
                            </span>
                          </button>
                        </MenuItem>
                      </MenuItems>
                    </Menu>

                    {/* dsh：输入栏工作区 picker（显式当前目录，可切换 / 添加） */}
                    {fsLive && (
                      <Menu>
                        <MenuButton
                          title={composerWsPath ? `工作区：${composerWsPath}` : '选择工作区'}
                          disabled={wsBusy}
                          className="group flex items-center gap-1 h-7 max-w-[min(40vw,11rem)] pl-1.5 pr-1 text-[13px] leading-5 font-medium text-stone-600 rounded-md outline-none focus:outline-none focus-visible:outline-none hover:bg-stone-100 data-[open]:bg-stone-100 transition-colors disabled:opacity-50"
                        >
                          <FolderIcon className="w-3.5 h-3.5 shrink-0 text-stone-500" />
                          <span className="truncate">{composerWsLabel}</span>
                          <ChevronIcon className="w-3.5 h-3.5 shrink-0 text-stone-400 transition-transform group-data-[open]:rotate-180" />
                        </MenuButton>
                        <MenuItems
                          transition
                          anchor={{ to: 'top start', gap: 8 }}
                          className="tw-select-menu tw-menu-anim z-50 w-[min(100vw-2rem,16rem)] rounded-xl border border-stone-200 py-1 shadow-xl focus:outline-none"
                        >
                          {(workspaceInfo?.items ?? []).map((item) => {
                            const active = item.path === composerWsPath;
                            return (
                              <MenuItem key={item.id}>
                                <button
                                  type="button"
                                  disabled={wsBusy}
                                  onClick={() => void pickComposerWorkspace(item)}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left data-[focus]:bg-stone-100 disabled:opacity-50"
                                >
                                  <FolderIcon className="w-4 h-4 shrink-0 text-stone-500" />
                                  <span
                                    className={`flex-1 min-w-0 truncate text-[13px] ${
                                      active ? 'text-stone-900 font-medium' : 'text-stone-700'
                                    }`}
                                    title={item.path}
                                  >
                                    {workspaceDisplayName(item, projectRootPath)}
                                  </span>
                                  {active && (
                                    <CheckIcon className="w-3.5 h-3.5 shrink-0 text-[#4176e6]" />
                                  )}
                                </button>
                              </MenuItem>
                            );
                          })}
                          {(workspaceInfo?.items?.length ?? 0) > 0 && (
                            <div className="my-1 border-t border-stone-100" />
                          )}
                          <MenuItem>
                            <button
                              type="button"
                              disabled={wsBusy}
                              onClick={() => void addWorkspaceByPicker()}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-stone-700 data-[focus]:bg-stone-100 disabled:opacity-50"
                            >
                              <span className="w-4 h-4 shrink-0 flex items-center justify-center text-stone-500 text-base leading-none">
                                +
                              </span>
                              添加工作区...
                            </button>
                          </MenuItem>
                        </MenuItems>
                      </Menu>
                    )}

                    {/* 访问权限（dsh 左侧权限菜单） */}
                    <Menu>
                      <MenuButton
                        title="访问权限"
                        className="group flex items-center gap-1 h-7 max-w-[220px] pl-2 pr-1 text-[13px] leading-5 font-medium text-stone-600 rounded-md outline-none focus:outline-none focus-visible:outline-none hover:bg-stone-100 data-[open]:bg-stone-100 transition-colors"
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
                        transition
                        anchor={{ to: 'top start', gap: 8 }}
                        className="tw-select-menu tw-menu-anim z-50 w-56 rounded-xl border border-stone-200 p-1 shadow-xl focus:outline-none"
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

                    {/* 发送 / 停止同一座位：生成中点按停止；空闲点按发送（繁忙续发仍可用 Enter） */}
                    <button
                      type="button"
                      onClick={() => {
                        if (streamingRef.current) {
                          stop();
                          return;
                        }
                        void send();
                      }}
                      disabled={!streaming && !canSend}
                      title={streaming ? '停止生成' : '发送'}
                      className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center outline-none focus:outline-none focus-visible:outline-none transition-colors ${
                        streaming
                          ? 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                          : 'bg-[#4176e6] text-white hover:bg-[#3565c7] disabled:bg-[#a9c3ef] disabled:cursor-not-allowed'
                      }`}
                    >
                      {streaming ? (
                        <span className="w-2.5 h-2.5 bg-current rounded-[2px]" />
                      ) : (
                        <SendIcon className="w-4 h-4" />
                      )}
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
          </div>
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
          wsRenameId ? (workspaceInfo?.items.find((x) => x.id === wsRenameId)?.name ?? '') : ''
        }
        confirmLabel="保存"
        cancelLabel="取消"
        onClose={() => setWsRenameId(null)}
        onConfirm={(name) => void confirmRenameWorkspace(name)}
      />
      <ConfirmDialog
        open={Boolean(purgeSessionId)}
        title="删除会话"
        message={
          purgeSessionId
            ? `确定永久删除「${store?.sessions.find((x) => x.id === purgeSessionId)?.title ?? '该会话'}」？此操作不可恢复。`
            : ''
        }
        confirmLabel="删除"
        cancelLabel="取消"
        danger="outline"
        onClose={() => setPurgeSessionId(null)}
        onConfirm={() => {
          if (!purgeSessionId) return;
          const id = purgeSessionId;
          setPurgeSessionId(null);
          purgeSession(id);
        }}
      />
      <ConfirmDialog
        open={Boolean(wsDeleteTarget)}
        title="删除工作区"
        message={
          wsDeleteTarget
            ? `将把「${wsDeleteTarget.name}」从工作区列表中移除。文件夹与会话记录会保留，其会话将归入项目根工作区。`
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
