/**
 * 交互式发布脚本 —— 文档 6.1 节
 *
 * 流程:
 * 1. 选择 bump 类型(major/minor/patch/自定义)
 * 2. 校验 + 构建 + 测试
 * 3. 输出 npm publish / git push 的具体命令(由用户在终端执行)
 *
 * 不自动执行 publish / push —— 需要用户登录 npm 账号与配置 Git 远端。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function log(msg) { console.log(`[release] ${msg}`); }
function step(msg) { console.log(`\n--- ${msg} ---\n`); }

function readPkg() {
  return JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
}

function bumpVersion(version, type) {
  const [major, minor, patch] = version.split('.').map(Number);
  switch (type) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    default: return version;
  }
}

function run(cmd, args = [], opts = {}) {
  log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  if (res.status !== 0 && !opts.allowFail) {
    process.exit(res.status ?? 1);
  }
  return res;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  step('步骤 1:选择 bump 类型');
  console.log('  a) major (x.0.0)  不兼容 API 变更');
  console.log('  b) minor (0.x.0)  向下兼容的功能新增');
  console.log('  c) patch (0.0.x)  向下兼容的问题修复');
  console.log('  d) custom         自定义版本号');
  const choice = await ask('请选择 [a/b/c/d]: ');

  const pkg = readPkg();
  const current = pkg.version;
  let next;

  switch (choice.toLowerCase()) {
    case 'a': next = bumpVersion(current, 'major'); break;
    case 'b': next = bumpVersion(current, 'minor'); break;
    case 'c': next = bumpVersion(current, 'patch'); break;
    case 'd':
      next = await ask(`当前 ${current},请输入新版本号: `);
      if (!/^\d+\.\d+\.\d+/.test(next)) {
        console.error(`非法版本号: ${next}`);
        process.exit(1);
      }
      break;
    default:
      console.error(`无效选择: ${choice}`);
      process.exit(1);
  }

  log(`版本变化:${current} → ${next}`);
  const confirm = await ask('确认?(y/N): ');
  if (confirm.toLowerCase() !== 'y') {
    log('已取消');
    process.exit(0);
  }

  step('步骤 2:更新 package.json');
  pkg.version = next;
  writeFileSync(resolve(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  log(`已写入新版本 ${next}`);

  step('步骤 3:运行测试(可选,失败继续)');
  const runTests = await ask('运行 vitest?(y/N): ');
  if (runTests.toLowerCase() === 'y') {
    run('npx', ['vitest', 'run'], { allowFail: true });
  }

  step('步骤 4:构建产物');
  run('node', ['scripts/build.mjs']);

  step('步骤 5:校验 Bundle');
  run('node', ['scripts/verify-bundle.mjs']);

  step('步骤 6:发布命令(请在终端手动执行)');
  console.log(`
# === git tag & push ===
git add -A
git commit -m "chore(release): v${next}"
git tag -a v${next} -m "InsightForge dsh Plugin v${next}"
git push origin main --tags

# === npm publish(若未登录会提示) ===
npm login                                # 首次发布需要,之后会被记住
npm publish --access public

# === 验证发布 ===
npm view insightforge-dsh-plugin version
dsh plugin add insightforge-dsh-plugin   # 在 dsh 环境中安装

# === 社区公告(可选) ===
# 打开 docs/ANNOUNCEMENT.md,粘贴到:
#   - dsh GitHub Discussions: https://github.com/deepseek-ai/deepseek-harness/discussions
#   - dsh 社区论坛(待定)
#   - 个人/团队 Twitter、博客等
`);

  log(`发布准备就绪: v${next}`);
}

main().catch((err) => {
  console.error('[release] 失败:', err);
  process.exit(1);
});