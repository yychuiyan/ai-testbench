/**
 * 全局悬浮提示控制器（data-hint）
 *
 * 为什么用「事件委托 + 单例气泡」而不是给每处包一个组件：
 * 全站的悬浮提示既有 React 岛（ChatApp / 各文档库），也有 Astro 静态模板（主导航、
 * 帮助中心）。静态模板无法使用 React 组件，逐个包组件又要改动大量 JSX 结构；
 * 委托方案只需替换属性，一处逻辑覆盖全部，且软导航（ClientRouter）后依然有效。
 *
 * 显示规则（对齐「只有被省略号截断时才提示」的约定）：
 * - 元素有可见文本 → 仅在文本真的溢出（scrollWidth > clientWidth）时提示；
 * - 元素只有图标、没有可见文本 → 始终提示，否则图标将失去唯一的可读说明；
 * - `data-hint-always` 强制始终提示，`data-hint-fit` 强制仅在截断时提示。
 *
 * 气泡挂在 body 下；软导航会替换 body 内容使其脱离文档，故每次显示前惰性重建。
 * 样式复用 global.css 的 .tw-tooltip / .tw-tooltip-anim（与 OverflowHint 同一套）。
 */

/** 层级：低于 ConfirmDialog 的 z-[90]，保证弹窗仍可覆盖气泡 */
const Z_INDEX = 80;
/** 气泡最大宽度（px） */
const MAX_WIDTH = 420;
/** 箭头中心距气泡左右边缘的最小内缩（px） */
const ARROW_INSET = 14;
/** 进出场时长（ms），需与 .tw-tooltip-anim 的 transition 一致 */
const ANIM_MS = 150;
/** 气泡与锚点的间距（px） */
const GAP = 6;

type Pos = { top: number; left: number; maxWidth: number; openUp: boolean; arrowLeft: number };

let tipEl: HTMLDivElement | null = null;
let arrowEl: HTMLSpanElement | null = null;
let textNode: Text | null = null;
/** 当前正在提示的锚点元素 */
let current: HTMLElement | null = null;
let pos: Pos | null = null;
let entered = false;
let enterRaf = 0;
let exitTimer = 0;
let inited = false;

/** 惰性创建 / 重建气泡（软导航后旧节点会脱离文档） */
function ensureTip(): void {
  if (tipEl && tipEl.isConnected) return;
  tipEl = document.createElement('div');
  tipEl.setAttribute('role', 'tooltip');
  tipEl.className =
    'tw-tooltip tw-tooltip-anim pointer-events-none fixed rounded-lg px-2.5 py-1.5 text-[12px] leading-5 break-all text-stone-700 shadow-lg';
  tipEl.style.zIndex = String(Z_INDEX);
  tipEl.dataset.closed = '';
  arrowEl = document.createElement('span');
  arrowEl.setAttribute('aria-hidden', 'true');
  arrowEl.className = 'tw-tooltip-arrow absolute h-2 w-2';
  arrowEl.style.transform = 'translateX(-50%) rotate(45deg)';
  textNode = document.createTextNode('');
  tipEl.append(arrowEl, textNode);
  document.body.appendChild(tipEl);
}

/** 按锚点当前位置计算坐标 */
function place(): void {
  if (!current) return;
  const r = current.getBoundingClientRect();
  const maxWidth = Math.min(Math.max(r.width, 160), MAX_WIDTH);
  const openUp = r.bottom + 72 > window.innerHeight - 8;
  const top = openUp ? r.top - GAP : r.bottom + GAP;
  const left = Math.max(8, Math.min(r.left, Math.max(8, window.innerWidth - maxWidth - 8)));
  // 箭头对准锚点水平中心；气泡被视口右缘夹住时按夹取后的位置跟随
  const arrowLeft = Math.max(
    ARROW_INSET,
    Math.min(r.left + r.width / 2 - left, maxWidth - ARROW_INSET),
  );
  pos = { top, left, maxWidth, openUp, arrowLeft };
}

/** 把坐标与上下翻转状态写入 DOM */
function apply(): void {
  if (!tipEl || !arrowEl || !pos) return;
  tipEl.style.top = `${pos.top}px`;
  tipEl.style.left = `${pos.left}px`;
  tipEl.style.maxWidth = `${pos.maxWidth}px`;
  tipEl.classList.toggle('is-up', pos.openUp);
  tipEl.classList.toggle('is-down', !pos.openUp);
  arrowEl.classList.toggle('is-up', pos.openUp);
  arrowEl.classList.toggle('is-down', !pos.openUp);
  arrowEl.style.left = `${pos.arrowLeft}px`;
  arrowEl.style.top = pos.openUp ? '' : '-5px';
  arrowEl.style.bottom = pos.openUp ? '-5px' : '';
}

/** 去掉仅供读屏的文本（sr-only），它们不构成可见标签 */
function visibleText(el: HTMLElement): string {
  let s = el.innerText || '';
  el.querySelectorAll('[class*="sr-only"]').forEach((n) => {
    const t = (n as HTMLElement).innerText;
    if (t) s = s.replace(t, '');
  });
  return s.replace(/\s+/g, ' ').trim();
}

function isTruncated(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth + 1;
}

/** 是否应当显示气泡 */
function shouldShow(el: HTMLElement): boolean {
  if (el.dataset.hintAlways !== undefined) return true;
  if (el.dataset.hintFit !== undefined) return isTruncated(el);
  return visibleText(el) ? isTruncated(el) : true;
}

/** 该元素此刻是否真的需要气泡（有文案且满足显示规则） */
function qualifies(el: HTMLElement): boolean {
  return Boolean(el.dataset.hint) && shouldShow(el);
}

function show(el: HTMLElement): void {
  const text = el.dataset.hint ?? '';
  if (!text || !shouldShow(el)) return;
  current = el;
  if (exitTimer) {
    window.clearTimeout(exitTimer);
    exitTimer = 0;
  }
  ensureTip();
  if (!tipEl || !textNode) return;
  textNode.data = text;
  place();
  apply();
  tipEl.style.display = '';
  // 双 rAF：先渲染收起态再切展开，否则首帧无起始值会跳过过渡
  cancelAnimationFrame(enterRaf);
  enterRaf = requestAnimationFrame(() => {
    enterRaf = requestAnimationFrame(() => {
      if (!tipEl) return;
      entered = true;
      delete tipEl.dataset.closed;
    });
  });
}

function hide(): void {
  current = null;
  if (!tipEl) return;
  entered = false;
  tipEl.dataset.closed = '';
  if (exitTimer) window.clearTimeout(exitTimer);
  exitTimer = window.setTimeout(() => {
    exitTimer = 0;
    if (entered) return; // 过渡期间又重新显示了
    if (tipEl) tipEl.style.display = 'none';
  }, ANIM_MS);
}

function anchorOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const hit = target.closest('[data-hint]');
  return hit instanceof HTMLElement ? hit : null;
}

function onOver(e: MouseEvent): void {
  const el = anchorOf(e.target);
  if (el === current) return;
  if (!el || !qualifies(el)) {
    // 指针移到了不需要气泡的元素上。通常 mouseout 已经收起，
    // 但旧锚点被 DOM 移除等情况下不会触发 mouseout，这里兜底。
    if (current) hide();
    return;
  }
  show(el);
}

function onOut(e: MouseEvent): void {
  const el = anchorOf(e.target);
  if (!el || el !== current) return;
  const to = e.relatedTarget;
  if (to instanceof Node && el.contains(to)) return; // 仍在元素内部
  hide();
}

function onFocusIn(e: FocusEvent): void {
  const el = anchorOf(e.target);
  if (el === current) return;
  if (!el || !qualifies(el)) {
    if (current) hide();
    return;
  }
  show(el);
}

function onFocusOut(e: FocusEvent): void {
  const el = anchorOf(e.target);
  if (!el || el !== current) return;
  const to = e.relatedTarget;
  if (to instanceof Node && el.contains(to)) return;
  hide();
}

/** 点击后收起，避免气泡停留在已经切换了状态的按钮上 */
function onClick(): void {
  if (current) hide();
}

/** 滚动 / 缩放时跟随锚点（capture 以覆盖内部滚动容器） */
function onMove(): void {
  if (!current) return;
  place();
  apply();
}

/**
 * 安装控制器。在布局里挂一次即可；对同一文档重复调用无副作用。
 * 监听器挂在 document 上，软导航替换 body 后仍继续生效。
 */
export function initHintTips(): void {
  if (typeof document === 'undefined' || inited) return;
  inited = true;
  document.addEventListener('mouseover', onOver, true);
  document.addEventListener('mouseout', onOut, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onMove, true);
  window.addEventListener('resize', onMove);
  // 软导航：气泡节点会随 body 内容被替换，重置引用即可，下次显示时重建
  document.addEventListener('astro:after-swap', () => {
    current = null;
    tipEl = null;
    arrowEl = null;
    textNode = null;
  });
}
