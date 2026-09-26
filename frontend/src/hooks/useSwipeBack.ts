/**
 * v1.8 P8-C: 移动端滑动返回手势
 *
 * 从屏幕左边缘向右滑动 > 80px 触发 navigate(-1),
 * 模拟 iOS/Android 原生"边缘返回"体验,移动端用户不再需要点左上角的"← 返回"按钮。
 *
 * 触发条件(全部满足才生效):
 *   1. 屏幕宽度 < 768px(md 断点以下视为移动端,桌面端不挂载)
 *   2. 当前路径不是 '/'(避免在首页边缘滑动手势把用户推到不存在的上一页)
 *   3. 没有 Modal 弹窗打开(Dialog / Modal 等打开时禁用,避免冲突)
 *   4. 触摸起点 clientX < 24px(屏幕最左侧 24px 内,模拟原生手势起点)
 *   5. 横向位移 > 80px 且持续时间 < 500ms(避免误触纵向滚动)
 *   6. 触摸过程中不向上滚(dy 不超过 dx 的 0.6 倍,确保用户意图是横向滑动)
 *
 * 用法: 在需要支持的页面顶层组件调用 useSwipeBack()
 *      hook 仅挂载 listener,无渲染副作用。
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const MOBILE_MAX_WIDTH = 768;
const EDGE_PX = 24;
const MIN_DX = 80;
const MAX_DURATION = 500;
const MAX_DY_RATIO = 0.6; // dy > dx * 0.6 视为纵向滚动,放弃

/** 检测"是否有任意 Modal / Dialog 打开" - 简单但可靠的策略:扫描顶层 [role="dialog"] */
function hasOpenModal(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[role="dialog"]') !== null;
}

export function useSwipeBack(): void {
  const navigate = useNavigate();

  useEffect(() => {
    // 仅移动端挂载
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH - 1}px)`);
    if (!mq.matches) return;

    let startX = 0;
    let startY = 0;
    let startTime = 0;
    let tracking = false;

    const onStart = (e: TouchEvent) => {
      // 排除多指触摸(避免与画布等双指缩放冲突)
      if (e.touches.length !== 1) {
        tracking = false;
        return;
      }
      const t = e.touches[0]!;
      if (t.clientX > EDGE_PX) {
        tracking = false;
        return; // 不在左边缘 → 不是边缘返回手势
      }
      if (hasOpenModal()) {
        tracking = false;
        return; // Modal 打开时不抢手势
      }
      tracking = true;
      startX = t.clientX;
      startY = t.clientY;
      startTime = Date.now();
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking || e.touches.length !== 1) return;
      const t = e.touches[0]!;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      // 向下/向上偏移过大 → 不是横向滑动,放弃
      if (Math.abs(dy) > Math.abs(dx) * MAX_DY_RATIO && dy > 20) {
        tracking = false;
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      // changedTouches 在 touchend 中提供最终位置
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const elapsed = Date.now() - startTime;
      // 横向位移达标 + 时长未超限 + 纵向位移不超标 → 触发返回
      if (dx >= MIN_DX && elapsed <= MAX_DURATION && dy <= dx * MAX_DY_RATIO) {
        // 阻止后续 click 事件触发,避免在按钮位置误触
        e.preventDefault();
        navigate(-1);
      }
    };

    const onCancel = () => {
      tracking = false;
    };

    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: false });
    window.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onCancel);
    };
  }, [navigate]);
}