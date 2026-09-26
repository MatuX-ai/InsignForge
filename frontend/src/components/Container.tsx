/**
 * Container - 页面 main 布局统一容器 (v1.8 P1-C)
 *
 * 解决 8 处页面 main 元素 max-width / padding 不一致问题:
 *   - 之前:每个页面单独写 `flex-1 px-6 py-10 max-w-Xxl mx-auto w-full`,规格散落
 *   - 之后:统一通过 Container + size 切换,改一处全部生效
 *
 * size 对照:
 *   - sm: 28rem / 448px (登录/单表单)
 *   - md: 48rem / 768px (默认 - 文档类: Readme/Settings/Report/Faq)
 *   - lg: 56rem / 896px (中等列表 - History)
 *   - xl: 64rem / 1024px (宽列表 - Monitor)
 *
 * display 模式:
 *   - content  (默认) - 标准内容页:flex-1 + 上下 padding + max-width + mx-auto
 *   - canvas           - 全高画布页:flex-1 + flex flex-col min-h-0 + max-width(无上下 padding)
 *   - centered         - 全局居中页:flex-1 + flex items-center justify-center + max-width(居中卡片)
 *
 * 与 min-h-screen 父容器配套使用(由 App.tsx 提供):
 *   <div className="min-h-screen flex flex-col bg-bg">
 *     <TopBar />
 *     <Container size="md">{children}</Container>
 *     <BottomBar />
 *   </div>
 */
import type { ReactNode } from 'react';

type ContainerSize = 'sm' | 'md' | 'lg' | 'xl';
type ContainerDisplay = 'content' | 'canvas' | 'centered';

interface Props {
  /** 容器宽度档位 - 默认 md */
  size?: ContainerSize;
  /** 布局模式 - 默认 content */
  display?: ContainerDisplay;
  /** 垂直方向 padding,可覆盖默认 py-10(content) / 无(canvas) / py-12(centered) */
  paddingY?: string;
  /** 自定义 max-width 类名,优先级高于 size */
  maxWidthClass?: string;
  children: ReactNode;
  className?: string;
}

const sizeMap: Record<ContainerSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-3xl',
  lg: 'max-w-4xl',
  xl: 'max-w-5xl',
};

export function Container({
  size = 'md',
  display = 'content',
  paddingY,
  maxWidthClass,
  children,
  className = '',
}: Props) {
  const widthClass = maxWidthClass ?? sizeMap[size];

  let layoutClass: string;
  let py: string;
  switch (display) {
    case 'canvas':
      // canvas: flex 画布,需要 flex flex-col min-h-0 子元素才能在 flex parent 中正确滚动
      layoutClass = 'flex-1 w-full mx-auto flex flex-col min-h-0';
      py = paddingY ?? '';
      break;
    case 'centered':
      // centered: 全局垂直 + 水平居中,适合 landing / onboarding 单卡页
      layoutClass = 'flex-1 w-full mx-auto flex items-center justify-center';
      py = paddingY ?? 'py-12';
      break;
    case 'content':
    default:
      layoutClass = 'flex-1 w-full mx-auto';
      py = paddingY ?? 'py-10';
      break;
  }

  return (
    <main className={`${layoutClass} px-6 ${py} ${widthClass} ${className}`}>
      {children}
    </main>
  );
}