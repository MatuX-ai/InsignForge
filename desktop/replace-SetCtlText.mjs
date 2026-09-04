// UTF-8 安全的 installer.nsh 替换:
// 把 SetCtlText $insightforgeMarqueeHWND "..." 改成
// System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "...")'
import fs from 'node:fs';
const file = 'e:\\Dady_project\\InsignForge\\desktop\\installer.nsh';
let content = fs.readFileSync(file, 'utf8');

// 匹配: SetCtlText $insightforgeMarqueeHWND "..."
// 替换: System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "...")'
const re = /^(\s*)SetCtlText \$insightforgeMarqueeHWND "([^"]*)"\s*$/gm;
const matches = content.match(re) || [];
console.log('匹配行数:', matches.length);

const newContent = content.replace(re, (_m, indent, text) => {
  return `${indent}System::Call 'user32::SetWindowTextW(i $insightforgeMarqueeHWND, w "${text}")'`;
});

fs.writeFileSync(file, newContent, 'utf8');
console.log('done. 写回字节数:', Buffer.byteLength(newContent, 'utf8'));
