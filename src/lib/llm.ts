import type { LLMSettings } from './settings';

/** OpenAI 兼容多模态 content 片段（文本 / 图片） */
export type ContentPart =
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type MessageContent = string | ContentPart[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: MessageContent;
  /** DeepSeek 思考模式：后续请求必须原样回传 */
  reasoning_content?: string;
}

/** 发给 API 的消息（含 tool 轮次） */
export interface ApiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent | null;
  /** DeepSeek 思考模式：有则必须带回 */
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

async function friendlyError(res: Response): Promise<Error> {
  const body = (await res.text().catch(() => '')).slice(0, 200);
  if (res.status === 401) return new Error('API Key 无效或已过期（401），请检查模型设置');
  if (res.status === 403) return new Error('访问被拒绝（403），请检查 Key 权限或账户状态');
  if (res.status === 429) return new Error('请求被限流（429），请稍后重试或检查账户额度');
  if (res.status === 404)
    return new Error('接口地址不存在（404），请检查 Base URL 是否以 /v1 结尾、模型名是否正确');
  return new Error(`请求失败（HTTP ${res.status}）${body ? `：${body}` : ''}`);
}

/**
 * 拉取 OpenAI 兼容端点的可用模型列表（GET /models）。
 * 用于模型设置中自动识别模型候选；失败时由调用方回退到预设内置列表。
 */
export async function fetchModels(baseURL: string, apiKey: string): Promise<string[]> {
  const url = `${baseURL.replace(/\/+$/, '')}/models`;
  // 10 秒超时：防止网络挂起导致界面永远停在「识别中」
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: Array<{ id?: string }> };
  const ids = (json.data ?? [])
    .map((m) => m?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return Array.from(new Set(ids)).sort();
}

/** 单次请求的 token 用量（流式末块携带，需请求时声明 stream_options.include_usage） */
export interface UsageInfo {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** 缓存命中（DeepSeek prompt_cache_hit_tokens / OpenAI cached_tokens） */
  cachedTokens?: number;
  /** 未命中缓存的输入（DeepSeek prompt_cache_miss_tokens；缺省时用 prompt - cached 推算） */
  uncachedTokens?: number;
  /** 缓存写入（OpenAI cache_creation 等；DeepSeek 通常为 0/缺失） */
  cacheWriteTokens?: number;
}

export type StreamChunk =
  | { type: 'reasoning'; delta: string } // 思考过程增量（DeepSeek 思考模式 reasoning_content）
  | { type: 'content'; delta: string } // 最终回答增量
  | { type: 'usage'; usage: UsageInfo } // 流结束前的用量统计
  | {
      type: 'tool';
      name: string;
      status: 'running' | 'done';
      args?: string;
      result?: string;
    }; // 工具调用进度（供时间线）

/**
 * 模型上下文窗口（tokens）。DeepSeek 官方「模型 & 价格」页核准：flash/v4-pro 均为 1M；
 * 其余为各厂商公开值。未收录的模型只显示用量、不显示百分比。
 */
export const MODEL_CONTEXT_WINDOW: Record<string, number> = {
  'deepseek-flash': 1_048_576,
  'deepseek-v4-pro': 1_048_576,
  'deepseek-v4-flash': 1_048_576, // 旧模型名，由 V4.1-Flash 提供服务
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'qwen-plus': 131_072,
};

export interface StreamOptions {
  /**
   * 是否关闭思考模式（DeepSeek：thinking.type=disabled）。
   * 默认不传该字段（DeepSeek 默认开启思考，其他端点无此概念不受影响）；
   * JSON 生成等求快求稳的场景可显式关闭。
   */
  thinking?: boolean;
}

/**
 * OpenAI 兼容协议的流式对话客户端（SSE 逐行解析）。
 * DeepSeek / 通义千问兼容模式 / OpenAI 及多数第三方网关均适用。
 * 支持 DeepSeek 思考模式：reasoning_content 以 type='reasoning' 增量产出。
 */
function applyThinkingOptions(
  body: Record<string, unknown>,
  settings: LLMSettings,
  options: StreamOptions,
) {
  if (options.thinking === false) {
    body.thinking = { type: 'disabled' };
  } else if (settings.reasoningEffort) {
    body.reasoning_effort = settings.reasoningEffort;
  }
}

export async function* streamChat(
  settings: LLMSettings,
  messages: ChatMessage[] | ApiMessage[],
  signal?: AbortSignal,
  options: StreamOptions = {},
): AsyncGenerator<StreamChunk> {
  const url = `${settings.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    stream: true,
    // 流式末块返回 token 用量（OpenAI 兼容协议；DeepSeek/通义/OpenAI 均支持，不识别的网关会忽略该字段）
    stream_options: { include_usage: true },
    temperature: 0.3, // 思考模式下该参数被 DeepSeek 忽略（文档明确不报错），非思考模式生效
  };
  applyThinkingOptions(body, settings, options);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new Error('网络请求失败，请检查 Base URL 是否可达、目标服务是否允许浏览器跨域调用');
  }

  if (!res.ok) throw await friendlyError(res);
  if (!res.body) throw new Error('响应无内容流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const json = JSON.parse(data);
          const deltaObj = json.choices?.[0]?.delta;
          const reasoning = deltaObj?.reasoning_content;
          if (typeof reasoning === 'string' && reasoning) {
            yield { type: 'reasoning', delta: reasoning };
          }
          const content = deltaObj?.content;
          if (typeof content === 'string' && content) {
            yield { type: 'content', delta: content };
          }
          // 用量块（choices 为空数组，usage 字段独立于 delta）
          const usage = json.usage;
          if (usage && typeof usage.prompt_tokens === 'number') {
            const cached =
              typeof usage.prompt_cache_hit_tokens === 'number'
                ? usage.prompt_cache_hit_tokens
                : typeof usage.prompt_tokens_details?.cached_tokens === 'number'
                  ? usage.prompt_tokens_details.cached_tokens
                  : undefined;
            const uncached =
              typeof usage.prompt_cache_miss_tokens === 'number'
                ? usage.prompt_cache_miss_tokens
                : cached != null
                  ? Math.max(0, usage.prompt_tokens - cached)
                  : undefined;
            const cacheWrite =
              typeof usage.prompt_cache_write_tokens === 'number'
                ? usage.prompt_cache_write_tokens
                : typeof usage.prompt_tokens_details?.cache_creation_tokens === 'number'
                  ? usage.prompt_tokens_details.cache_creation_tokens
                  : undefined;
            yield {
              type: 'usage',
              usage: {
                cachedTokens: cached,
                uncachedTokens: uncached,
                cacheWriteTokens: cacheWrite,
                promptTokens: usage.prompt_tokens,
                completionTokens:
                  typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
                totalTokens:
                  typeof usage.total_tokens === 'number' ? usage.total_tokens : usage.prompt_tokens,
              },
            };
          }
        } catch {
          // 忽略半包 JSON，等待后续数据拼齐
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 非流式补全（用于工具轮次 / 后台任务）。
 * 默认关闭思考模式以加快响应、降低费用。
 */
export async function completeChat(
  settings: LLMSettings,
  messages: ChatMessage[] | ApiMessage[],
  signal?: AbortSignal,
  options: StreamOptions = { thinking: false },
): Promise<string> {
  let text = '';
  for await (const chunk of streamChat(settings, messages, signal, options)) {
    if (chunk.type === 'content') text += chunk.delta;
  }
  return text.trim();
}

interface CompletionResult {
  content: string | null;
  reasoning_content?: string;
  tool_calls?: ToolCall[];
  usage?: UsageInfo;
}

/** DeepSeek V4 DSML 标签中的管道符：全角 ｜ 或 ASCII |（供 RegExp 源串拼接） */
const DSML_PIPE = '[\\uFF5C|]';
/**
 * 开/闭标签里 DSML 与动词之间的分隔：
 * - 单竖线：`<|DSML|calls>` / `<｜DSML｜invoke>`
 * - 双竖线（V4 常见）：`<|DSML||calls>` / `<|DSML||invoke>`
 */
const DSML_SEP = `${DSML_PIPE}{1,2}`;
/** 开标签前缀：`<|DSML||` 或 `<｜DSML｜`（普通模板，`\\s` → RegExp 空白） */
const DSML_OPEN = `<\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_SEP}`;
/** 闭标签前缀：`</|DSML||` */
const DSML_CLOSE = `<\\/\\s*${DSML_PIPE}\\s*DSML\\s*${DSML_SEP}`;

function newDsmlCallId(index: number): string {
  return `dsml_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseDsmlParams(paramBody: string, paramRe: RegExp): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  paramRe.lastIndex = 0;
  let paramMatch: RegExpExecArray | null;
  while ((paramMatch = paramRe.exec(paramBody)) !== null) {
    const key = paramMatch[1];
    const asString = paramMatch[2] === 'true';
    const raw = paramMatch[3] ?? '';
    if (!key) continue;
    if (asString) {
      args[key] = raw;
    } else {
      try {
        args[key] = JSON.parse(raw);
      } catch {
        args[key] = raw;
      }
    }
  }
  return args;
}

function collectDsmlInvokes(scope: string, invokeRe: RegExp, paramRe: RegExp): ToolCall[] {
  const calls: ToolCall[] = [];
  invokeRe.lastIndex = 0;
  let invokeMatch: RegExpExecArray | null;
  while ((invokeMatch = invokeRe.exec(scope)) !== null) {
    const name = (invokeMatch[1] ?? '').trim();
    if (!name) continue;
    const args = parseDsmlParams(invokeMatch[2] ?? '', paramRe);
    calls.push({
      id: newDsmlCallId(calls.length),
      type: 'function',
      function: { name, arguments: JSON.stringify(args) },
    });
  }
  return calls;
}

/** 文本是否仍含 DSML 工具调用痕迹（用于 UI / 产出闸门） */
export function looksLikeDsml(text: string): boolean {
  return typeof text === 'string' && /DSML/i.test(text);
}

/**
 * 解析 DeepSeek V4 系模型写入 content 的 DSML 工具调用。
 * 官方/兼容网关本应转成 message.tool_calls；未转换时会泄漏为可见正文。
 */
export function parseDsmlToolCalls(content: string): { calls: ToolCall[]; cleaned: string } {
  if (!content || !/DSML/i.test(content)) {
    return { calls: [], cleaned: content };
  }

  const blockRe = new RegExp(
    `${DSML_OPEN}\\s*(?:tool_)?calls\\s*>` +
      `([\\s\\S]*?)` +
      `${DSML_CLOSE}\\s*(?:tool_)?calls\\s*>`,
    'gi',
  );
  const invokeRe = new RegExp(
    `${DSML_OPEN}\\s*invoke\\s+name="([^"]+)"\\s*>` +
      `([\\s\\S]*?)` +
      `${DSML_CLOSE}\\s*invoke\\s*>`,
    'gi',
  );
  const paramRe = new RegExp(
    `${DSML_OPEN}\\s*parameter\\s+name="([^"]+)"\\s+string="(true|false)"\\s*>` +
      `([\\s\\S]*?)` +
      `${DSML_CLOSE}\\s*parameter\\s*>`,
    'gi',
  );

  const calls: ToolCall[] = [];
  let cleaned = content;
  let blockMatch: RegExpExecArray | null;
  const blocks: string[] = [];
  while ((blockMatch = blockRe.exec(content)) !== null) {
    blocks.push(blockMatch[0]);
    calls.push(...collectDsmlInvokes(blockMatch[1] ?? '', invokeRe, paramRe));
  }

  // 无完整 calls 包裹时：仍尝试解析散落的 invoke（部分网关/模型变体）
  if (!calls.length) {
    calls.push(...collectDsmlInvokes(content, invokeRe, paramRe));
  }

  for (const block of blocks) {
    cleaned = cleaned.replace(block, '');
  }
  // 未闭合或未知变体：从首个 DSML 痕迹起整段丢掉，禁止标签进 UI
  cleaned = scrubDsmlArtifacts(cleaned);
  cleaned = cleaned.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { calls, cleaned };
}

/**
 * 去掉残留 / 未闭合 / 未知变体的 DSML 痕迹及其后内容。
 * 宁可少显示正文，也不把工具调用标签露给用户。
 */
export function scrubDsmlArtifacts(text: string): string {
  if (!text || !/DSML/i.test(text)) return text;

  const detectors: RegExp[] = [
    new RegExp(DSML_OPEN, 'i'),
    /<\s*\/?\s*[^>]*DSML/i,
    /[\uFF5C|]\s*DSML\s*[\uFF5C|]{1,2}/i,
    /DSML\s*[\uFF5C|]{0,2}\s*(?:tool_)?calls/i,
    /DSML\s*[\uFF5C|]{0,2}\s*invoke/i,
    /DSML\s*[\uFF5C|]{0,2}\s*parameter/i,
  ];

  let cut = -1;
  for (const re of detectors) {
    const m = re.exec(text);
    if (m && m.index != null && (cut < 0 || m.index < cut)) cut = m.index;
  }
  if (cut >= 0) return text.slice(0, cut).trimEnd();

  // 最后兜底：丢掉任何含 DSML 的行
  return text
    .split('\n')
    .filter((line) => !/DSML/i.test(line))
    .join('\n')
    .trim();
}

/** 产出前闸门：保证交给 UI 的正文不含 DSML */
export function sanitizeAssistantContent(text: string | null | undefined): string {
  if (!text) return '';
  if (!looksLikeDsml(text)) return text;
  const { cleaned } = parseDsmlToolCalls(text);
  return scrubDsmlArtifacts(cleaned);
}

/** 优先用结构化 tool_calls；否则从 content 解析 DSML */
function resolveToolCalls(result: CompletionResult): {
  calls: ToolCall[];
  content: string | null;
} {
  const structured = result.tool_calls?.filter((c) => c?.function?.name) ?? [];
  const rawContent = result.content;
  if (structured.length) {
    if (typeof rawContent === 'string' && looksLikeDsml(rawContent)) {
      const { cleaned } = parseDsmlToolCalls(rawContent);
      return { calls: structured, content: sanitizeAssistantContent(cleaned) || null };
    }
    return { calls: structured, content: rawContent };
  }
  if (typeof rawContent === 'string' && rawContent) {
    const { calls, cleaned } = parseDsmlToolCalls(rawContent);
    if (calls.length) return { calls, content: sanitizeAssistantContent(cleaned) || null };
    return { calls: [], content: sanitizeAssistantContent(rawContent) || null };
  }
  return { calls: [], content: rawContent };
}

/** 非流式 chat/completions，可选 tools */
async function completeOnce(
  settings: LLMSettings,
  messages: ApiMessage[],
  signal: AbortSignal | undefined,
  options: StreamOptions,
  tools?: ToolDef[],
): Promise<CompletionResult> {
  const url = `${settings.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    stream: false,
    temperature: 0.3,
  };
  applyThinkingOptions(body, settings, options);
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new Error('网络请求失败，请检查 Base URL 是否可达、目标服务是否允许浏览器跨域调用');
  }
  if (!res.ok) throw await friendlyError(res);
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: ToolCall[];
      };
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_cache_miss_tokens?: number;
    };
  };
  const msg = json.choices?.[0]?.message;
  const usageRaw = json.usage;
  const usage: UsageInfo | undefined =
    usageRaw && typeof usageRaw.prompt_tokens === 'number'
      ? {
          promptTokens: usageRaw.prompt_tokens,
          completionTokens: usageRaw.completion_tokens ?? 0,
          totalTokens: usageRaw.total_tokens ?? usageRaw.prompt_tokens,
          cachedTokens: usageRaw.prompt_cache_hit_tokens,
          uncachedTokens: usageRaw.prompt_cache_miss_tokens,
        }
      : undefined;
  const reasoning =
    typeof msg?.reasoning_content === 'string' && msg.reasoning_content
      ? msg.reasoning_content
      : undefined;
  return {
    content: msg?.content ?? null,
    reasoning_content: reasoning,
    tool_calls: msg?.tool_calls,
    usage,
  };
}

export interface ToolChatOptions extends StreamOptions {
  tools?: ToolDef[];
  /** 执行工具：返回写入 role=tool 的 content 字符串 */
  runTool?: (name: string, argsJson: string) => Promise<string>;
  /** 工具循环上限，防止死循环 */
  maxToolRounds?: number;
}

/**
 * 带工具的对话：非流式跑工具轮次（含 DSML 回退解析），无工具后直接产出最终回答。
 * 避免再开一轮不带 tools 的流式请求，把 DeepSeek DSML 当正文泄漏到 UI。
 */
export async function* streamChatWithTools(
  settings: LLMSettings,
  messages: ChatMessage[],
  signal?: AbortSignal,
  options: ToolChatOptions = {},
): AsyncGenerator<StreamChunk> {
  const tools = options.tools ?? [];
  const runTool = options.runTool;
  if (!tools.length || !runTool) {
    yield* streamChatScrubbingDsml(settings, messages, signal, options);
    return;
  }

  const apiMessages: ApiMessage[] = messages.map((m) => {
    const msg: ApiMessage = { role: m.role, content: m.content };
    if (m.role === 'assistant' && m.reasoning_content) {
      msg.reasoning_content = m.reasoning_content;
    }
    return msg;
  });
  const maxRounds = options.maxToolRounds ?? 5;
  // 工具轮与最终回答共用思考设置：DeepSeek 要求带 tool_calls 的 assistant
  // 若产生过 reasoning_content，后续请求必须原样回传。
  const toolOpts: StreamOptions = { ...options };

  for (let round = 0; round < maxRounds; round++) {
    const result = await completeOnce(settings, apiMessages, signal, toolOpts, tools);
    const { calls, content } = resolveToolCalls(result);

    if (calls.length) {
      const assistantMsg: ApiMessage = {
        role: 'assistant',
        content,
        tool_calls: calls,
      };
      if (result.reasoning_content) {
        assistantMsg.reasoning_content = result.reasoning_content;
      }
      apiMessages.push(assistantMsg);
      for (const call of calls) {
        const name = call.function.name;
        const args = call.function.arguments ?? '{}';
        yield { type: 'tool', name, status: 'running', args };
        const out = await runTool(name, args);
        yield {
          type: 'tool',
          name,
          status: 'done',
          args,
          result: out.length > 800 ? `${out.slice(0, 800)}…` : out,
        };
        apiMessages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: out,
        });
      }
      continue;
    }

    // 无工具调用：直接产出本轮（保留思考过程），不再二次 streamChat
    if (result.reasoning_content) {
      yield { type: 'reasoning', delta: result.reasoning_content };
    }
    const safeContent = sanitizeAssistantContent(content);
    if (safeContent) {
      yield { type: 'content', delta: safeContent };
    }
    if (result.usage) {
      yield { type: 'usage', usage: result.usage };
    }
    return;
  }

  // 轮次耗尽：兜底流式，并过滤 DSML
  yield* streamChatScrubbingDsml(settings, apiMessages, signal, options);
}

/**
 * 流式输出，缓冲正文并剥离 DSML；若解析出工具调用则不再把标签交给 UI
 * （无 runTool 时仅 scrub，无法执行）。
 */
async function* streamChatScrubbingDsml(
  settings: LLMSettings,
  messages: ChatMessage[] | ApiMessage[],
  signal?: AbortSignal,
  options: StreamOptions = {},
): AsyncGenerator<StreamChunk> {
  let contentBuf = '';
  let dsmlHold = false;
  let visibleEmitted = '';

  for await (const chunk of streamChat(settings, messages, signal, options)) {
    if (chunk.type !== 'content') {
      yield chunk;
      continue;
    }
    contentBuf += chunk.delta;
    if (!dsmlHold) {
      const startRe = new RegExp(DSML_OPEN, 'i');
      const m = startRe.exec(contentBuf);
      if (m && m.index != null) {
        dsmlHold = true;
        const safe = contentBuf.slice(0, m.index);
        const delta = safe.slice(visibleEmitted.length);
        if (delta) {
          visibleEmitted = safe;
          yield { type: 'content', delta };
        }
        continue;
      }
      // 保留更长尾部，避免半截 `<|DSML||` / `<｜DSML｜` 被提前吐出
      const hold = 24;
      if (contentBuf.length > hold) {
        const safe = contentBuf.slice(0, contentBuf.length - hold);
        const delta = safe.slice(visibleEmitted.length);
        if (delta) {
          visibleEmitted = safe;
          yield { type: 'content', delta };
        }
      }
      continue;
    }
  }

  const finalText = sanitizeAssistantContent(contentBuf);
  const rest = finalText.slice(visibleEmitted.length);
  if (rest) yield { type: 'content', delta: rest };
}
