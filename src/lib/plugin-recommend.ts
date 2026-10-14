/**
 * 插件能力推荐：仅靠 BYOK 模型 + 本仓库上下文，不依赖 dsh / awesome 远程列表。
 * 结果缓存 localStorage。
 */
import { PLUGIN_CATALOG, type PluginId } from './plugins';
import { completeChat } from './llm';
import type { LLMSettings } from './settings';

export interface CapabilityRecommendation {
  /** 建议仿制的能力短名 */
  name: string;
  /** high = 优先做；medium = 可排期 */
  priority: 'high' | 'medium';
  reason: string;
  /** 在本仓库如何落地（岛 / 工具 / 中间件） */
  emulateHint: string;
}

export interface RecommendCache {
  fetchedAt: number;
  model: string;
  /** 生成时内置插件开关快照，用于判断缓存是否仍适用 */
  enabledSnapshot: string;
  items: CapabilityRecommendation[];
}

const CACHE_KEY = 'tw.plugin-recommend.v2';
/** 缓存有效期 7 天；开关变化会另判失效 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const WORKBENCH_CONTEXT =
  '产品：TestBench（Astro 静态站 + React 岛 + BYOK，可部署 GitHub Pages）。\n' +
  '已有模块：多会话 AI 对话、功能用例生成与导出、模板库、知识库 Markdown、插件开关页。\n' +
  '架构约束：无服务端；可写盘能力仅 npm run dev 本地 Vite 中间件；不能安装 DeepSeek Harness / Cordis 插件，只能仿能力。\n' +
  '受众：测试工程师（需求/用例/报告/缺陷/质量风险）。';

export function enabledSnapshot(enabled: Record<PluginId, boolean>): string {
  return PLUGIN_CATALOG.map((p) => `${p.id}:${enabled[p.id] ? 1 : 0}`).join(',');
}

export function loadRecommendCache(): RecommendCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecommendCache;
    if (!Array.isArray(parsed.items) || typeof parsed.fetchedAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveRecommendCache(cache: RecommendCache): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function isRecommendCacheValid(
  cache: RecommendCache | null,
  enabled: Record<PluginId, boolean>,
): boolean {
  if (!cache) return false;
  if (Date.now() - cache.fetchedAt > CACHE_TTL_MS) return false;
  return cache.enabledSnapshot === enabledSnapshot(enabled);
}

function extractJsonArray(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON 数组');
  return JSON.parse(candidate.slice(start, end + 1));
}

function normalize(raw: unknown): CapabilityRecommendation[] {
  if (!Array.isArray(raw)) return [];
  const out: CapabilityRecommendation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? o.title ?? '').trim();
    const reason = String(o.reason ?? o.why ?? '').trim();
    const emulateHint = String(o.emulateHint ?? o.how ?? o.hint ?? '').trim();
    if (!name || !reason) continue;
    const priority = o.priority === 'high' || o.priority === 'medium' ? o.priority : 'medium';
    out.push({
      name,
      priority,
      reason,
      emulateHint: emulateHint || '评估后以 Astro 岛 + 可选本地中间件落地。',
    });
    if (out.length >= 8) break;
  }
  return out;
}

export type RecommendMode = 'hint' | 'project';

export async function generateCapabilityRecommendations(
  settings: LLMSettings,
  enabled: Record<PluginId, boolean>,
  userHint: string,
  signal?: AbortSignal,
  mode: RecommendMode = userHint.trim() ? 'hint' : 'project',
): Promise<RecommendCache> {
  const builtin = PLUGIN_CATALOG.map(
    (p) =>
      `- ${p.id}「${p.name}」默认${p.defaultEnabled ? '开' : '关'}，当前${enabled[p.id] ? '开' : '关'}：${p.description}`,
  ).join('\n');

  const hint = userHint.trim();
  const focus =
    mode === 'hint' && hint
      ? `模式：按用户诉求推荐。\n用户诉求：\n${hint}\n\n` +
        `要求：紧扣用户诉求排序与选型；对测试工程师实用；可在静态站 + 可选本地 dev 中间件实现；不要重复已有等价能力；不要主题/桌宠等无关项。\n`
      : `模式：按本项目现状推荐（不依赖用户临时诉求）。\n\n` +
        `要求：补齐测试工作台缺口（对话/用例/模板/知识库/报告/质量流程）；可在静态站 + 可选本地 dev 中间件实现；不要重复已有等价能力；不要主题/桌宠等无关项。\n`;

  const prompt =
    `${WORKBENCH_CONTEXT}\n\n` +
    `当前内置插件：\n${builtin}\n\n` +
    focus +
    `请推荐最多 6 个「下一步值得仿到本工作台」的能力插件（能力短名，不是 dsh 安装包名）。\n` +
    `只输出 JSON 数组，每项字段：name, priority("high"|"medium"), reason, emulateHint。`;

  const text = await completeChat(
    settings,
    [
      {
        role: 'system',
        content:
          '你是测试工作台产品顾问。根据产品现状或用户诉求推荐可落地的能力增强，严格只输出 JSON 数组。',
      },
      { role: 'user', content: prompt },
    ],
    signal,
    { thinking: false },
  );

  const items = normalize(extractJsonArray(text));
  if (!items.length) throw new Error('模型未给出可用推荐，请重试');

  const cache: RecommendCache = {
    fetchedAt: Date.now(),
    model: settings.model,
    enabledSnapshot: enabledSnapshot(enabled),
    items,
  };
  saveRecommendCache(cache);
  return cache;
}
