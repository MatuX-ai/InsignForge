// Smoke test —— 验证 ESM 产物可被 Node 加载并导出预期符号
import {
  InsightForgeCore,
  createInsightForgeCore,
  getDepthProfile,
  validateConfig,
  tryValidateConfig,
  MarketReportSchema,
  KeywordExtractionSchema,
  KEYWORD_EXTRACTION_SYSTEM,
  REPORT_GENERATION_SYSTEM,
  buildKeywordExtractionUserPrompt,
  buildReportUserPrompt,
  SimpleLRUCache,
  Semaphore,
  hasSqliteBindings,
  generateLanding,
  searchHackerNews,
  searchReddit,
  searchOpenSerp,
  aggregate,
  chatJson,
  resetLlmClient,
  logger,
} from './dist/index.js';

console.log('=== ESM 产物加载验证 ===');

console.log('InsightForgeCore:', typeof InsightForgeCore);
console.log('createInsightForgeCore:', typeof createInsightForgeCore);
console.log('getDepthProfile:', typeof getDepthProfile);
console.log('validateConfig:', typeof validateConfig);
console.log('tryValidateConfig:', typeof tryValidateConfig);
console.log('MarketReportSchema:', typeof MarketReportSchema.parse);
console.log('KeywordExtractionSchema:', typeof KeywordExtractionSchema.parse);
console.log('KEYWORD_EXTRACTION_SYSTEM len:', KEYWORD_EXTRACTION_SYSTEM.length);
console.log('REPORT_GENERATION_SYSTEM len:', REPORT_GENERATION_SYSTEM.length);
console.log('buildKeywordExtractionUserPrompt:', typeof buildKeywordExtractionUserPrompt);
console.log('buildReportUserPrompt:', typeof buildReportUserPrompt);
console.log('SimpleLRUCache:', typeof SimpleLRUCache);
console.log('Semaphore:', typeof Semaphore);
console.log('hasSqliteBindings:', typeof hasSqliteBindings, '->', hasSqliteBindings());
console.log('generateLanding:', typeof generateLanding);
console.log('searchHackerNews:', typeof searchHackerNews);
console.log('searchReddit:', typeof searchReddit);
console.log('searchOpenSerp:', typeof searchOpenSerp);
console.log('aggregate:', typeof aggregate);
console.log('chatJson:', typeof chatJson);
console.log('resetLlmClient:', typeof resetLlmClient);
console.log('logger:', typeof logger.info);

// 实际调用
const cfg = validateConfig({ llmApiKey: 'smoke-test-key' });
console.log('\n=== Config 校验 ===');
console.log('Config.llmProvider:', cfg.llmProvider);
console.log('Config.llmApiKey:', cfg.llmApiKey);
console.log('Config.searchProvider:', cfg.searchProvider);

const profile = getDepthProfile('standard');
console.log('\n=== Depth Profile ===');
console.log('standard.keywordCount:', profile.keywordCount);
console.log('standard.maxTokens:', profile.maxTokens);

const landing = generateLanding({
  idea: 'Smoke Test Idea',
  value_proposition: '测试',
});
console.log('\n=== Landing ===');
console.log('landing.html bytes:', landing.size);
console.log('landing.theme:', landing.theme);

const sem = new Semaphore(3);
console.log('\n=== Semaphore ===');
console.log('semaphore.capacity:', sem.capacity);
console.log('semaphore.pending:', sem.pending);

const cache = new SimpleLRUCache(10, 60_000);
cache.set('k', 'v');
console.log('\n=== Cache ===');
console.log('cache.get("k"):', cache.get('k'));
console.log('cache.size:', cache.size);

console.log('\n✓ ESM smoke test passed');