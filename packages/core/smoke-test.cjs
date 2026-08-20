// CJS Smoke test —— 验证 CommonJS 产物可被 Node 加载
const core = require('./dist/index.cjs');

console.log('=== CJS 产物加载验证 ===');

const keys = [
  'InsightForgeCore',
  'createInsightForgeCore',
  'getDepthProfile',
  'validateConfig',
  'tryValidateConfig',
  'MarketReportSchema',
  'KeywordExtractionSchema',
  'KEYWORD_EXTRACTION_SYSTEM',
  'REPORT_GENERATION_SYSTEM',
  'buildKeywordExtractionUserPrompt',
  'buildReportUserPrompt',
  'SimpleLRUCache',
  'Semaphore',
  'hasSqliteBindings',
  'generateLanding',
  'searchHackerNews',
  'searchReddit',
  'searchOpenSerp',
  'aggregate',
  'chatJson',
  'resetLlmClient',
  'logger',
];

let okCount = 0;
let failCount = 0;
for (const k of keys) {
  if (typeof core[k] !== 'undefined') {
    okCount++;
    console.log(`  [OK]   ${k} = ${typeof core[k]}`);
  } else {
    failCount++;
    console.log(`  [FAIL] ${k} undefined`);
  }
}

console.log(`\n${okCount} OK, ${failCount} FAIL`);

// 实际调用
const cfg = core.validateConfig({ llmApiKey: 'cjs-smoke' });
console.log('\n=== CJS Config ===');
console.log('cfg.llmProvider:', cfg.llmProvider);
console.log('cfg.maxConcurrent:', cfg.maxConcurrent);

const landing = core.generateLanding({ idea: 'CJS Test', value_proposition: 'test' });
console.log('\n=== CJS Landing ===');
console.log('landing.html bytes:', landing.size);

if (failCount > 0) process.exit(1);
console.log('\n✓ CJS smoke test passed');