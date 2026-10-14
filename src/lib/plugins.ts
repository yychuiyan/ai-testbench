/**
 * 内置插件注册表：开关存应用配置（本地文件 / localStorage 回退）。
 * 插件随仓库发布，不提供远程安装/更新。
 * 新增插件：更新 PLUGIN_CATALOG，并在 config/app.defaults.json 的 plugins 中补默认值。
 */
import { getCachedAppConfig, updateAppConfig, flushAppConfig } from './app-config';

export type PluginId =
  | 'memory'
  | 'knowledge'
  | 'caseGen'
  | 'promptGen'
  | 'knowledgeGen';

export interface PluginMeta {
  id: PluginId;
  name: string;
  description: string;
  version: string;
  /** 是否依赖本地中间件 */
  requiresDev: boolean;
  /** 首次访问时的默认开关 */
  defaultEnabled: boolean;
  /** 可在输入框「/」唤起并打开面板 */
  hasPanel?: boolean;
}

export const PLUGIN_CATALOG: PluginMeta[] = [
  {
    id: 'caseGen',
    name: '生成测试用例',
    description: '在工作台用「/」打开配置：选类型、模板与提示词后生成用例并写入用例库。',
    version: '0.1.0',
    requiresDev: true,
    defaultEnabled: true,
    hasPanel: true,
  },
  {
    id: 'promptGen',
    name: '生成提示词',
    description: '用「/」打开配置后对话生成提示词；质检通过后写入提示词库，可在提示词管理中查看。',
    version: '0.1.0',
    requiresDev: true,
    defaultEnabled: true,
    hasPanel: true,
  },
  {
    id: 'knowledgeGen',
    name: '生成知识库',
    description: '用「/」打开配置后对话生成规范、方法论或环境约定；质检通过后写入知识库。',
    version: '0.1.0',
    requiresDev: true,
    defaultEnabled: true,
    hasPanel: true,
  },
  {
    id: 'knowledge',
    name: '知识库检索',
    description: '工作台输入「@」引用知识库与模板文档；发送后由模型按需读取。',
    version: '1.4.0',
    requiresDev: false,
    defaultEnabled: true,
  },
  {
    id: 'memory',
    name: '会话记忆',
    description:
      '五轨记忆（用户档案 / 全局事实 / 项目关键 / 项目日志 / 每日）：待确认、归档与便签，在工作台「记忆」Tab 管理。',
    version: '2.0.0',
    requiresDev: true,
    defaultEnabled: true,
  },
];

const EVENT = 'tw-plugins-changed';

function defaults(): Record<PluginId, boolean> {
  const map = {} as Record<PluginId, boolean>;
  for (const p of PLUGIN_CATALOG) map[p.id] = p.defaultEnabled;
  return map;
}

export function loadPluginEnabled(): Record<PluginId, boolean> {
  const base = defaults();
  const fromFile = getCachedAppConfig().plugins ?? {};
  for (const p of PLUGIN_CATALOG) {
    if (typeof fromFile[p.id] === 'boolean') base[p.id] = fromFile[p.id]!;
  }
  return base;
}

export function isPluginEnabled(id: PluginId): boolean {
  return loadPluginEnabled()[id];
}

export function setPluginEnabled(id: PluginId, enabled: boolean): Record<PluginId, boolean> {
  const next = { ...loadPluginEnabled(), [id]: enabled };
  updateAppConfig({ plugins: next });
  void flushAppConfig();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }));
  }
  return next;
}

export function onPluginEnabledChanged(cb: (map: Record<PluginId, boolean>) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<Record<PluginId, boolean>>).detail;
    cb(detail ?? loadPluginEnabled());
  };
  window.addEventListener(EVENT, handler);
  return () => {
    window.removeEventListener(EVENT, handler);
  };
}

export function getPluginMeta(id: PluginId): PluginMeta | undefined {
  return PLUGIN_CATALOG.find((p) => p.id === id);
}

/** 插件未启用时的拦截文案 */
export function pluginDisabledMessage(id: PluginId): string {
  const name = getPluginMeta(id)?.name ?? id;
  return `请先在「我的插件」中启用「${name}」`;
}
