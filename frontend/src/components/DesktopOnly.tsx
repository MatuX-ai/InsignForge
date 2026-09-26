/**
 * DesktopOnly - 仅桌面端渲染内容 (v1.8 P0-A3)
 *
 * 典型用法:
 *   <DesktopOnly fallback={<span>仅桌面端可用</span>}>
 *     <Button onClick={...}>打开归档文件</Button>
 *   </DesktopOnly>
 *
 * 与 useDesktopApi 的关系:
 *   isDesktop 信号集中通过 hook 消费,避免组件各处自行探测 window.insightforge.
 */
import type { ReactNode } from 'react';
import { useDesktopApi } from '../hooks/useDesktopApi';

interface Props {
  children: ReactNode;
  /** web 端渲染的占位(默认不渲染) */
  fallback?: ReactNode;
}

export function DesktopOnly({ children, fallback = null }: Props) {
  const { isDesktop } = useDesktopApi();
  return <>{isDesktop ? children : fallback}</>;
}
