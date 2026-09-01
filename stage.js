const { execFileSync } = require('child_process');
const cwd = 'e:\\Dady_project\\InsignForge';

function run(args) {
  return execFileSync('git', ['--no-pager', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 100 * 1024 * 1024,
  });
}

console.log('=== git add -A ===');
console.log(run(['add', '-A']));

console.log('=== git status --short ===');
const s = run(['status', '--short']);
console.log(s);

const lines = s.split('\n').filter(x => x.trim());
const staged = lines.filter(x => !x.startsWith('??')).length;
const untracked = lines.filter(x => x.startsWith('??')).length;
console.log('STAGED:', staged, 'UNTRACKED:', untracked);