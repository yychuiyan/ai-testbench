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

/** 高于空间管理弹窗 z-[95]/z-[96]，否则弹窗内路径气泡会被挡住；点击会先收起气泡 */
const Z_INDEX = 100;
/** 气泡最大宽度（px） */
const MAX_WIDTH = 420;
/** 箭头中心距气泡左右边缘的最小内缩（px） */
const ARROW_INSET = 14;
/** 进出场时长（ms），需与 .tw-tooltip-anim 的 transition 一致 */
const ANIM_MS = 150;
/** 气泡与锚点的间距（px） */
const GAP = 6;
/** 悬停期间也自动收起：图标按钮的气泡不应一直挂在界面上 */
const AUTO_HIDE_MS = 3200;

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
let autoHideTimer = 0;
let watchRaf = 0;
let inited = false;
/** 气泡由鼠标悬停打开（而非键盘焦点），此时要盯住指针是否还在锚点上 */
let openedByPointer = false;
/** 最近一次指针位置；拿不到时不按位置判断，避免误收 */
let pointerPos: { x: number; y: number } | null = null;
/**
 * 最近一次交互是鼠标还是键盘。
 * 点击按钮会让它获得焦点：若此时再按 focusin 弹气泡，气泡会因为「有焦点」而不被收起，
 * 看起来就是点完按钮后气泡一直挂着。只有键盘导航才用焦点弹气泡。
 */
let pointerModality = false;

/**
 * 锚点已经不该再挂气泡：被卸载、收进关闭中的弹层、或尺寸归零。
 * 这些情况经常不触发 mouseout；鼠标停着也不会补发 mouseover。
 */
function anchorGone(el: HTMLElement): boolean {
  if (!el.isConnected) return true;
  if (el.closest('[data-closed]')) return true;
  // display:none / visibility:hidden / content-visibility:hidden 都不会触发 mouseout
  if (el.checkVisibility && !el.checkVisibility()) return true;
  const r = el.getBoundingClientRect();
  return r.width === 0 && r.height === 0;
}

/** 锚点滚出视口后气泡没有意义，而且会浮在边缘看起来「卡住」 */
function anchorOffscreen(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return (
    r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth
  );
}

function insideRect(r: DOMRect, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function stopWatch(): void {
  if (!watchRaf) return;
  cancelAnimationFrame(watchRaf);
  watchRaf = 0;
}

/** 气泡显示期间盯着锚点，弹窗一关 / 滚走 / 指针离开就收，避免漂在页面上 */
function startWatch(): void {
  stopWatch();
  const tick = () => {
    watchRaf = 0;
    const el = current;
    if (!el) return;
    if (anchorGone(el) || anchorOffscreen(el)) {
      hide();
      return;
    }
    if (
      openedByPointer &&
      pointerPos &&
      !insideRect(el.getBoundingClientRect(), pointerPos.x, pointerPos.y)
    ) {
      // 布局变化 / 滚动 / 元素被替换后指针已经不在锚点上，但不会补发 mouseout
      hide();
      return;
    }
    // 键盘打开的气泡：焦点移走（元素被 React 替换、弹层关闭）后同样不会补发 focusout
    if (!openedByPointer && !el.contains(document.activeElement)) {
      hide();
      return;
    }
    watchRaf = requestAnimationFrame(tick);
  };
  watchRaf = requestAnimationFrame(tick);
}

/** 惰性创建 / 重建气泡（软导航后旧节点会脱离文档） */
function ensureTip(): void {
  if (tipEl && tipEl.isConnected) return;
  tipEl = document.createElement('div');
  tipEl.setAttribute('role', 'tooltip');
  tipEl.className =
    'tw-tooltip tw-tooltip-anim pointer-events-none fixed rounded-md px-2 py-1 text-[12px] leading-5 break-all text-stone-700 shadow-lg';
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

function show(el: HTMLElement, byPointer: boolean): void {
  const text = el.dataset.hint ?? '';
  if (!text || !shouldShow(el)) return;
  current = el;
  openedByPointer = byPointer;
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
  startWatch();
  if (autoHideTimer) window.clearTimeout(autoHideTimer);
  autoHideTimer = window.setTimeout(() => {
    autoHideTimer = 0;
    if (current === el) hide();
  }, AUTO_HIDE_MS);
}

function hide(): void {
  stopWatch();
  current = null;
  openedByPointer = false;
  if (autoHideTimer) {
    window.clearTimeout(autoHideTimer);
    autoHideTimer = 0;
  }
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
  pointerModality = true;
  const el = anchorOf(e.target);
  if (el === current) return;
  if (!el || !qualifies(el)) {
    // 指针移到了不需要气泡的元素上。通常 mouseout 已经收起，
    // 但旧锚点被 DOM 移除等情况下不会触发 mouseout，这里兜底。
    if (current) hide();
    return;
  }
  show(el, true);
}

function onOut(e: MouseEvent): void {
  const el = anchorOf(e.target);
  if (!el || el !== current) return;
  const to = e.relatedTarget;
  if (to instanceof Node && el.contains(to)) return; // 仍在元素内部
  hide();
}

function onFocusIn(e: FocusEvent): void {
  // 鼠标点击也会触发 focusin：此时不让焦点再弹一次气泡，否则点击后气泡没人收
  if (pointerModality) return;
  const el = anchorOf(e.target);
  if (el === current) return;
  if (!el || !qualifies(el)) {
    if (current) hide();
    return;
  }
  show(el, false);
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
  if (anchorGone(current) || anchorOffscreen(current)) {
    hide();
    return;
  }
  place();
  apply();
}

/** 记录指针位置：布局变化后指针可能已经不在锚点上，靠它兜底收起 */
function onPointerMove(e: PointerEvent): void {
  pointerPos = { x: e.clientX, y: e.clientY };
  pointerModality = true;
}

/** 按下即收起，避免拖拽 / 弹层切换后气泡留在原地 */
function onPointerDown(): void {
  pointerModality = true;
  if (current) hide();
}

function onKey(e: KeyboardEvent): void {
  // 键盘一介入就切回「焦点驱动」，之后 Tab 到图标按钮仍会正常提示
  pointerModality = false;
  if (e.key === 'Escape' && current) hide();
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
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('focusin', onFocusIn, true);
  document.addEventListener('focusout', onFocusOut, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('scroll', onMove, true);
  window.addEventListener('resize', onMove);
  // 切到别的窗口 / 标签页后指针事件不再送达，气泡会一直挂着
  window.addEventListener('blur', () => {
    if (current) hide();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && current) hide();
  });
  // 指针移出窗口（浏览器地址栏、另一个应用）时也可能收不到 mouseout
  document.documentElement.addEventListener('mouseleave', () => {
    if (current) hide();
  });
  // 软导航：气泡节点会随 body 内容被替换，重置引用即可，下次显示时重建
  document.addEventListener('astro:after-swap', () => {
    stopWatch();
    if (autoHideTimer) {
      window.clearTimeout(autoHideTimer);
      autoHideTimer = 0;
    }
    current = null;
    if (tipEl?.isConnected) tipEl.remove();
    tipEl = null;
    arrowEl = null;
    textNode = null;
  });
}
