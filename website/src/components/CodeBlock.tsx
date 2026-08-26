/**
 * 复用组件:代码块(带复制按钮)、徽章
 */
import { useState } from 'react';
import { Icon } from './Icon';

interface CodeBlockProps {
  commands: { label: string; command: string }[];
  language?: string;
}

export function CodeBlock({ commands }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const text = commands.map((c) => c.command).join('\n');

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 忽略剪贴板权限失败
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-border-solid bg-bg-tertiary/80 shadow-glass">
      <div className="flex items-center justify-between border-b border-border-solid bg-bg-secondary/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-danger/70" />
          <span className="h-3 w-3 rounded-full bg-warning/70" />
          <span className="h-3 w-3 rounded-full bg-success/70" />
          <span className="ml-3 text-xs text-text-tertiary">terminal</span>
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 rounded-md border border-border-solid px-2 py-1 text-xs text-text-secondary transition hover:border-primary/60 hover:text-text-primary"
        >
          <Icon name={copied ? 'check' : 'copy'} className="h-3.5 w-3.5" />
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div className="divide-y divide-border-solid">
        {commands.map((c) => (
          <div key={c.label} className="grid grid-cols-[140px_1fr] items-center gap-4 px-4 py-2.5 text-sm">
            <span className="text-xs uppercase tracking-wider text-text-tertiary">
              {c.label}
            </span>
            <code className="font-mono text-text-primary break-all">
              <span className="select-none text-primary-light">$ </span>
              {c.command}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}