import { useCallback, useState } from 'react';

/**
 * 列表入场动画开关。
 *
 * `tw-anim-list` 的 `tw-fade-up` 是纯 CSS 动画，只要元素挂载就会播一遍。
 * 首帧（刷新 / 首次进入页面）数据还在异步加载，等列表渲染出来再播动画，
 * 视觉上就是整块内容「跳」一下；而侧栏导航没有这个类，所以只有内容区在动。
 *
 * 这里把动画改成「按需」：首帧不播，只有用户在页内触发排序 / 筛选 / 翻页等
 * 主动操作后才播，既保留切换时的过渡感，又不让刷新时的首屏跳动。
 *
 * 用法：
 *   const { cls, play } = useListAnim();
 *   <ul className={`${cls}space-y-1`}> ... </ul>
 *   onClick={() => { play(); onPage(next); }}
 *
 * cls 在开启时自带尾随空格，直接与后面的工具类拼即可，不会多出空类名。
 */
export function useListAnim(): { cls: string; play: () => void } {
  const [on, setOn] = useState(false);
  // 一旦开启就不再关闭：动画类需一直挂着，后续子项变化才会继续有过渡
  const play = useCallback(() => setOn(true), []);
  return { cls: on ? 'tw-anim-list ' : '', play };
}
