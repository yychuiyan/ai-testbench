import { useEffect, useMemo, useRef, useState } from 'react';
import { saveCaseSuite } from '../../lib/case-suites';
import {
  hydrateAppConfig,
  loadSettings,
  onSettingsChanged,
  openSettings,
  type LLMSettings,
} from '../../lib/settings';
import { streamChat, type ChatMessage } from '../../lib/llm';
import {
  CASE_FIELDS,
  exportCsv,
  exportMarkdown,
  exportXlsx,
  type TestCaseRow,
} from '../../lib/export';
import CaseLibrary, { type KnowledgeSuiteProp } from './CaseLibrary';
import CaseTable from './CaseTable';

interface KnowledgeDoc {
  id: string;
  title: string;
  category: string;
  body: string;
}

interface Props {
  knowledgeDocs: KnowledgeDoc[];
  knowledgeSuites: KnowledgeSuiteProp[];
}

const SYSTEM_PROMPT =
  '你是资深测试工程师，精通等价类划分、边界值分析、场景法、错误推测等用例设计方法。';

const CONTEXT_BUDGET = 8000;

function buildMessages(requirement: string, module: string, docs: KnowledgeDoc[]): ChatMessage[] {
  let user = `请为以下需求设计功能测试用例。\n\n【需求描述】\n${requirement}\n`;
  if (module.trim()) user += `\n【所属模块】${module.trim()}\n`;

  if (docs.length > 0) {
    user += '\n【参考文档】\n';
    let budget = CONTEXT_BUDGET;
    for (const d of docs) {
      if (budget <= 0) break;
      const chunk = d.body.slice(0, budget);
      user += `\n《${d.title}》\n${chunk}\n`;
      budget -= chunk.length;
    }
  }

  user += `
【输出要求】
1. 仅输出一个 JSON 数组，不要输出任何其他文字、解释或思考过程；
2. 数组元素为用例对象，字段固定为：用例编号、所属模块、用例标题、前置条件、测试步骤、预期结果、优先级、用例类型；
3. 用例编号格式 TC-模块缩写-三位序号；优先级取 P0/P1/P2；用例类型取 功能正常/功能异常/边界值/场景组合；
4. 测试步骤用编号分步书写，预期结果与步骤一一对应；
5. 覆盖正常流程、异常流程与边界条件，输出 8-15 条。`;

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/** 从模型输出中提取 JSON 数组：优先 ```json 代码块，其次全文首个 [...] 结构 */
function extractJsonArray(text: string): unknown[] | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence?.[1] ?? text.match(/\[[\s\S]*\]/)?.[0];
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeCases(arr: unknown[]): TestCaseRow[] {
  return arr.map((item) => {
    const obj = (item ?? {}) as Record<string, unknown>;
    const row = {} as TestCaseRow;
    for (const f of CASE_FIELDS) {
      const v = obj[f];
      row[f] = typeof v === 'string' ? v : v == null ? '' : String(v);
    }
    return row;
  });
}

type Phase = 'idle' | 'generating' | 'done' | 'parse-failed';

export default function CaseGenerator({ knowledgeDocs, knowledgeSuites }: Props) {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [module, setModule] = useState('');
  const [requirement, setRequirement] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('idle');
  const [rawOutput, setRawOutput] = useState('');
  const [cases, setCases] = useState<TestCaseRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [focusSuiteId, setFocusSuiteId] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const rawRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    void hydrateAppConfig().then(() => setSettings(loadSettings()));
    return onSettingsChanged(() => setSettings(loadSettings()));
  }, []);

  const docsByCategory = useMemo(() => {
    const map = new Map<string, KnowledgeDoc[]>();
    for (const d of knowledgeDocs) {
      const list = map.get(d.category) ?? [];
      list.push(d);
      map.set(d.category, list);
    }
    return map;
  }, [knowledgeDocs]);

  function toggleDoc(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function generate() {
    if (!requirement.trim() || phase === 'generating') return;
    if (!settings) {
      openSettings('model');
      return;
    }
    setError(null);
    setCases([]);
    setRawOutput('');
    setShowRaw(false);
    setPhase('generating');

    const docs = knowledgeDocs.filter((d) => selected.has(d.id));
    const messages = buildMessages(requirement, module, docs);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let full = '';
    try {
      // JSON 生成场景关闭思考模式：响应更快、输出更直接
      for await (const chunk of streamChat(settings, messages, ctrl.signal, { thinking: false })) {
        if (chunk.type !== 'content') continue;
        full += chunk.delta;
        setRawOutput(full);
        rawRef.current?.scrollTo({ top: rawRef.current.scrollHeight });
      }
      const arr = extractJsonArray(full);
      if (arr) {
        setCases(normalizeCases(arr));
        setPhase('done');
      } else {
        setPhase('parse-failed');
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setError(e instanceof Error ? e.message : String(e));
      }
      setPhase('idle');
    } finally {
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onSaveToLibrary() {
    if (!cases.length) return;
    const title =
      (module.trim() ? `${module.trim()} · ` : '') +
      new Date().toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    const suite = saveCaseSuite({
      title,
      module: module.trim() || undefined,
      cases,
    });
    setFocusSuiteId(suite.id);
    setSaveHint(`已保存「${suite.title}」（${suite.cases.length} 条）`);
    window.setTimeout(() => setSaveHint(null), 3200);
  }

  const canGenerate = requirement.trim().length > 0 && phase !== 'generating';

  return (
    <div className="space-y-6">
      <CaseLibrary knowledgeSuites={knowledgeSuites} focusSuiteId={focusSuiteId} />

      <div>
        <h2 className="text-base font-semibold text-stone-900">用例生成</h2>
        <p className="mt-0.5 text-xs text-stone-500">
          输入需求描述，可勾选知识库文档作为上下文；生成后可导出或保存到上方用例库。
        </p>
      </div>

      {/* 输入区 */}
      <section className="bg-white border border-stone-200 rounded-xl p-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            所属模块 <span className="text-stone-400 font-normal">（可选，用于用例编号）</span>
          </label>
          <input
            type="text"
            value={module}
            onChange={(e) => setModule(e.target.value)}
            placeholder="例如：登录、购物车、会员中心"
            className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-stone-700 mb-1.5">
            需求描述 <span className="text-red-500">*</span>
          </label>
          <textarea
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            rows={8}
            placeholder="粘贴需求描述或用户故事，越具体生成的用例越贴合实际。例如：&#10;用户可通过手机号+验证码登录。验证码 6 位数字，5 分钟内有效，连续错误 5 次锁定账号 30 分钟……"
            className="w-full px-3 py-2 text-sm border border-stone-300 rounded-md leading-6 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500"
          />
        </div>

        {knowledgeDocs.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1.5">
              引用知识库文档{' '}
              <span className="text-stone-400 font-normal">（可选，作为生成上下文）</span>
            </label>
            <div className="border border-stone-200 rounded-md divide-y divide-stone-100">
              {[...docsByCategory.entries()].map(([cat, docs]) => (
                <div key={cat} className="px-4 py-3">
                  <div className="text-xs font-medium text-stone-400 mb-2">{cat}</div>
                  <div className="space-y-1.5">
                    {docs.map((d) => (
                      <label
                        key={d.id}
                        className="flex items-center gap-2 -mx-2 px-2 py-1 rounded-md text-sm text-stone-700 cursor-pointer hover:bg-amber-50/70 hover:text-stone-900 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(d.id)}
                          onChange={() => toggleDoc(d.id)}
                          className="rounded border-stone-300 text-amber-500 focus:ring-amber-500/40"
                        />
                        {d.title}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          {phase === 'generating' ? (
            <button
              onClick={stop}
              className="px-5 py-2.5 text-sm font-medium text-stone-700 bg-stone-200 rounded-lg hover:bg-stone-300 transition-colors"
            >
              停止生成
            </button>
          ) : (
            <button
              onClick={generate}
              disabled={!canGenerate}
              className="px-5 py-2.5 text-sm font-medium text-white bg-stone-900 rounded-lg hover:bg-amber-400 hover:text-stone-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {settings ? '生成用例' : '先配置模型'}
            </button>
          )}
          {!settings && (
            <button
              onClick={() => openSettings('model')}
              className="text-sm text-amber-700 hover:underline"
            >
              前往设置
            </button>
          )}
          {selected.size > 0 && (
            <span className="text-xs text-stone-400">已选 {selected.size} 份文档作为上下文</span>
          )}
        </div>
      </section>

      {/* 错误提示 */}
      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 生成中：流式原文 */}
      {phase === 'generating' && (
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <h2 className="text-sm font-medium text-stone-700">正在生成…</h2>
          </div>
          <pre
            ref={rawRef}
            className="max-h-72 overflow-y-auto text-xs leading-5 text-stone-600 bg-stone-50 rounded-md p-4 whitespace-pre-wrap"
          >
            {rawOutput || '等待模型响应…'}
          </pre>
        </section>
      )}

      {/* 解析失败：展示原文 */}
      {phase === 'parse-failed' && (
        <section className="bg-white border border-amber-300 rounded-xl p-6">
          <h2 className="text-sm font-medium text-amber-800">
            未能从输出中解析出用例表格，请重试（或复制下方原始输出人工整理）
          </h2>
          <pre className="mt-3 max-h-72 overflow-y-auto text-xs leading-5 text-stone-600 bg-stone-50 rounded-md p-4 whitespace-pre-wrap">
            {rawOutput}
          </pre>
          <button
            onClick={generate}
            className="mt-4 px-4 py-2 text-sm font-medium text-white bg-stone-900 rounded-lg hover:bg-amber-400 hover:text-stone-900 transition-colors"
          >
            重新生成
          </button>
        </section>
      )}

      {/* 结果表格 */}
      {phase === 'done' && cases.length > 0 && (
        <section className="bg-white border border-stone-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h2 className="text-base font-semibold text-stone-900">
              生成结果{' '}
              <span className="ml-1 text-sm font-normal text-stone-400">{cases.length} 条</span>
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={onSaveToLibrary}
                className="px-3 py-1.5 text-xs font-medium text-white bg-[#4176e6] rounded-md hover:bg-[#3565c7] transition-colors"
              >
                保存到用例库
              </button>
              <button
                onClick={() => exportXlsx(cases)}
                className="px-3 py-1.5 text-xs font-medium text-white bg-stone-900 rounded-md hover:bg-amber-400 hover:text-stone-900 transition-colors"
              >
                导出 Excel
              </button>
              <button
                onClick={() => exportCsv(cases)}
                className="px-3 py-1.5 text-xs text-stone-600 border border-stone-300 rounded-md hover:bg-stone-100 hover:border-stone-400 hover:text-stone-900 transition-colors"
              >
                导出 CSV
              </button>
              <button
                onClick={() => exportMarkdown(cases)}
                className="px-3 py-1.5 text-xs text-stone-600 border border-stone-300 rounded-md hover:bg-stone-100 hover:border-stone-400 hover:text-stone-900 transition-colors"
              >
                导出 Markdown
              </button>
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="px-3 py-1.5 text-xs text-stone-400 hover:text-stone-600 hover:underline underline-offset-2 transition-colors"
              >
                {showRaw ? '隐藏原文' : '查看原文'}
              </button>
            </div>
          </div>

          {saveHint ? (
            <p className="mb-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
              {saveHint}
            </p>
          ) : null}

          {showRaw && (
            <pre className="mb-4 max-h-60 overflow-y-auto text-xs leading-5 text-stone-600 bg-stone-50 rounded-md p-4 whitespace-pre-wrap">
              {rawOutput}
            </pre>
          )}

          <CaseTable cases={cases} />

          <p className="mt-3 text-xs text-stone-400">
            AI 生成内容需人工评审后入库，重点核对需求覆盖度与预期结果的准确性。
          </p>
        </section>
      )}
    </div>
  );
}
