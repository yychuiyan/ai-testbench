/**
 * 轻量界面文案：随通用设置 language 切换。
 */
import type { AppLanguage } from './settings';
import { loadGeneralPrefs, onGeneralPrefsChanged } from './settings';

const ZH = {
  'nav.home': '我的工作台',
  'nav.requirements': '需求文档库',
  'nav.caseManage': '用例管理',
  'nav.cases': '用例',
  'nav.templates': '测试模板库',
  'nav.docs': '文档库',
  'nav.prompts': '提示词管理',
  'nav.knowledge': '知识库管理',
  'nav.plugins': '我的插件',
  'nav.brand': 'TestBench',
  'nav.tagline': '让测试更高效一点',
  'nav.settings': '设置',
  'nav.changelog': '变更日志',
  'nav.changelogShort': '版本日志',
  'nav.repo': 'GitHub 仓库',
  'nav.repoShort': '仓库',
  'nav.npm': 'npm 包',
  'nav.npmShort': 'npm',
  'nav.site': '炊烟小站',
  'nav.siteShort': '小站',
  'nav.board': '留言板',
  'nav.boardShort': '留言',

  'settings.general': '通用设置',
  'settings.model': '模型',
  'settings.close': '关闭',
  'settings.access': '权限',
  'settings.accessDesc': '选择新会话的默认权限模式',
  'settings.language': '语言',
  'settings.appearance': '外观',
  'settings.appear.light': '浅色',
  'settings.appear.dark': '深色',
  'settings.appear.system': '跟随系统',
  'settings.fontSize': '字号大小',
  'settings.fontSizeDesc': '调整正文与会话内容的字号（不影响侧栏布局）',
  'settings.toolSteps': '工作步骤展示',
  'settings.toolStepsDesc': '选择希望看到多少工具调用细节',
  'settings.busySend': '繁忙时的发送行为',
  'settings.busySendDesc': '智能体运行时 Enter 键和发送按钮的行为；Cmd/Ctrl+Enter 使用另一行为',
  'settings.busySend.queue': '排队发送',
  'settings.busySend.interrupt': '插话发送',
  'settings.platformVersion': '平台版本',
  'settings.access.readonly': '仅可查看',
  'settings.access.readwrite': '工作区内修改',
  'settings.access.full': '完全权限',
  'settings.step.concise': '简洁',
  'settings.step.standard': '标准',
  'settings.step.detailed': '详细',
  'settings.step.full': '完全展开',
  'settings.modelIntro': '填入各提供商的 API 密钥即可使用其模型。',
  'settings.edit': '编辑',
  'settings.delete': '删除',
  'settings.addProvider': '+ 添加模型提供商',
  'settings.back': '返回',
  'settings.editProvider': '编辑提供商',
  'settings.addProviderTitle': '添加提供商',
  'settings.cancel': '取消',
  'settings.save': '保存',
  'settings.displayName': '显示名称',
  'settings.preset': '服务商预设',
  'settings.baseUrl': 'Base URL',
  'settings.apiKey': 'API Key',
  'settings.modelField': '模型',
  'settings.keyHint': '保存到本地 .local/app.config.json，不会上传 GitHub。',
  'settings.modelPlaceholder': '请输入模型名',
  'settings.recognizing': '识别中…',
  'settings.recognized': '已识别 {n} 个',
  'settings.recognizeFail': '识别失败，可手动填模型名',
  'settings.recognizeKeep': '刷新失败，沿用已有列表',
  'settings.deleteConfirm': '确定删除该模型提供商？',

  'chat.emptyTitle': '欢迎使用 TestBench',
  'chat.emptyBenefits': '你的 AI 小助理，帮助你梳理测试点、设计用例、执行脚本、对齐规范与风险。',
  'chat.emptyNoModel': '使用前请先配置模型。',
  'chat.configureModel': '配置模型',
  'chat.workbench': '我的工作台',
  'chat.newSession': '新会话',
  'chat.workspace': '工作区',

  'tool.running': '工具执行中…',
  'tool.callingKind': '正在调用{kind}',
  'tool.doneKind': '{kind}完成',
  'tool.callingNamed': '正在调用{kind}：{name}',
  'tool.doneNamed': '{kind}完成：{name}',
  'tool.callingFull': '正在调用{kind}（{name}）…',
  'tool.doneFull': '{kind}已完成（{name}）',
  'tool.kind.kb': '知识库',
  'tool.kind.fs': '本地文件',
  'tool.kind.memory': '会话记忆',
  'tool.kind.webSearch': '网页搜索',
  'tool.kind.webFetch': '网页获取',
} as const;

type MsgKey = keyof typeof ZH;

const EN: Record<MsgKey, string> = {
  'nav.home': 'My Workbench',
  'nav.requirements': 'Requirements',
  'nav.caseManage': 'Test Cases',
  'nav.cases': 'Cases',
  'nav.templates': 'Test Templates',
  'nav.docs': 'Documents',
  'nav.prompts': 'Prompts',
  'nav.knowledge': 'Knowledge Mgmt',
  'nav.plugins': 'My Plugins',
  'nav.brand': 'TestBench',
  'nav.tagline': 'Make testing a bit more efficient',
  'nav.settings': 'Settings',
  'nav.changelog': 'Changelog',
  'nav.changelogShort': 'Changelog',
  'nav.repo': 'GitHub',
  'nav.repoShort': 'Repo',
  'nav.npm': 'npm package',
  'nav.npmShort': 'npm',
  'nav.site': 'Yycy Docs',
  'nav.siteShort': 'Site',
  'nav.board': 'Message board',
  'nav.boardShort': 'Board',

  'settings.general': 'General',
  'settings.model': 'Models',
  'settings.close': 'Close',
  'settings.access': 'Permissions',
  'settings.accessDesc': 'Default permission mode for new sessions',
  'settings.language': 'Language',
  'settings.appearance': 'Appearance',
  'settings.appear.light': 'Light',
  'settings.appear.dark': 'Dark',
  'settings.appear.system': 'System',
  'settings.fontSize': 'Font size',
  'settings.fontSizeDesc': 'Body and session text size (sidebar layout stays fixed)',
  'settings.toolSteps': 'Tool step detail',
  'settings.toolStepsDesc': 'How much tool-call detail to show',
  'settings.busySend': 'Send while busy',
  'settings.busySendDesc':
    'Enter / Send while the agent is running; Cmd/Ctrl+Enter uses the other action',
  'settings.busySend.queue': 'Queue',
  'settings.busySend.interrupt': 'Interrupt',
  'settings.platformVersion': 'Platform version',
  'settings.access.readonly': 'View only',
  'settings.access.readwrite': 'Edit in workspace',
  'settings.access.full': 'Full access',
  'settings.step.concise': 'Concise',
  'settings.step.standard': 'Standard',
  'settings.step.detailed': 'Detailed',
  'settings.step.full': 'Full',
  'settings.modelIntro': 'Add each provider’s API key to use its models.',
  'settings.edit': 'Edit',
  'settings.delete': 'Delete',
  'settings.addProvider': '+ Add model provider',
  'settings.back': 'Back',
  'settings.editProvider': 'Edit provider',
  'settings.addProviderTitle': 'Add provider',
  'settings.cancel': 'Cancel',
  'settings.save': 'Save',
  'settings.displayName': 'Display name',
  'settings.preset': 'Provider preset',
  'settings.baseUrl': 'Base URL',
  'settings.apiKey': 'API Key',
  'settings.modelField': 'Model',
  'settings.keyHint': 'Saved to local .local/app.config.json; never pushed to GitHub.',
  'settings.modelPlaceholder': 'Enter model id',
  'settings.recognizing': 'Detecting…',
  'settings.recognized': '{n} models found',
  'settings.recognizeFail': 'Detection failed — enter a model id manually',
  'settings.recognizeKeep': 'Refresh failed — keeping previous list',
  'settings.deleteConfirm': 'Delete this model provider?',

  'chat.emptyTitle': 'Welcome to TestBench',
  'chat.emptyBenefits':
    'A little AI assistant for QA engineers: clarify test points, design cases, run scripts, and align on standards and risks.',
  'chat.emptyNoModel': 'Configure a model to get started.',
  'chat.configureModel': 'Configure model',
  'chat.workbench': 'My Workbench',
  'chat.newSession': 'New chat',
  'chat.workspace': 'Workspace',

  'tool.running': 'Running tool…',
  'tool.callingKind': 'Calling {kind}',
  'tool.doneKind': '{kind} done',
  'tool.callingNamed': 'Calling {kind}: {name}',
  'tool.doneNamed': '{kind} done: {name}',
  'tool.callingFull': 'Calling {kind} ({name})…',
  'tool.doneFull': '{kind} finished ({name})',
  'tool.kind.kb': 'knowledge base',
  'tool.kind.fs': 'local files',
  'tool.kind.memory': 'memory',
  'tool.kind.webSearch': 'web search',
  'tool.kind.webFetch': 'web fetch',
};

const DICT: Record<AppLanguage, Record<MsgKey, string>> = {
  'zh-CN': ZH,
  en: EN,
};

export type I18nKey = MsgKey;

export function t(key: MsgKey, vars?: Record<string, string | number>, lang?: AppLanguage): string {
  const l = lang ?? (typeof window !== 'undefined' ? loadGeneralPrefs().language : 'zh-CN');
  let s = DICT[l]?.[key] ?? DICT['zh-CN'][key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** 同步侧栏等静态 DOM 上的 data-i18n 文案 */
export function applyDomI18n(lang?: AppLanguage): void {
  if (typeof document === 'undefined') return;
  const l = lang ?? loadGeneralPrefs().language;
  document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n as MsgKey | undefined;
    if (!key || !(key in ZH)) return;
    el.textContent = t(key, undefined, l);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.dataset.i18nTitle as MsgKey | undefined;
    if (!key || !(key in ZH)) return;
    el.title = t(key, undefined, l);
  });
}

/** 订阅语言变化并刷新 data-i18n（在布局里挂一次即可） */
export function bindDomI18n(): () => void {
  applyDomI18n();
  return onGeneralPrefsChanged((p) => applyDomI18n(p.language));
}
