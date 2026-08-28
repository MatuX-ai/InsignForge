/**
 * LLM Provider 注册表
 *
 * 集中维护 InsightForge 支持的大模型提供商清单,供以下场景共用:
 * - 后端 SettingsService:生成 providerKeyMap / baseUrl / 错误提示
 * - 后端 config.ts: 按需读取对应 *_API_KEY 环境变量
 * - 后端 api/settings.ts: 校验 provider 枚举值
 * - 前端 Settings/OnboardingModal: 渲染下拉选项与"去获取 API Key"链接
 *
 * 新增 Provider 流程:
 * 1. 在下方 LLM_PROVIDERS 数组中追加一项(必填 id / label / baseUrl / envKeyName / requiresKey;
 *    可选 keyUrl / defaultModel / suggestedModels / supportsThinkingDisable)
 * 2. 在后端 .env.example / 前端 .env.example 中补一行 `<envKeyName>=` 占位(已通过注册表自动生成提示文案)
 * 3. 后端 config.ts zod schema 中补一行 `z.string().optional()`
 * 4. 后端 config.ts 的 getLlmApiKey() 中补一行 case
 *
 * 注:仅 OpenAI 兼容协议的 Provider 才可加入;私有协议需要单独适配 client。
 */
export type LlmProviderId =
  | 'deepseek'
  | 'openai'
  | 'ollama'
  // 国产大模型(OpenAI 兼容协议)
  | 'zhipu'      // 智谱 BigModel / GLM-4
  | 'qwen'       // 通义千问 DashScope(OpenAI 兼容模式)
  | 'moonshot'   // 月之暗面 Kimi
  | 'yi'         // 零一万物
  | 'MiniMax'      // MiniMax MiniMax
  | 'hunyuan'    // 腾讯混元
  | 'sensenova'  // 商汤日日新 SenseChat
  | 'stepfun';   // 阶跃星辰 Step-1/Step-2

export interface LlmProviderMeta {
  /** 唯一 id,序列化友好,作为 LLM_PROVIDER 环境变量值 */
  id: LlmProviderId;
  /** 中文标签,用于前端下拉显示 */
  label: string;
  /** 英文/品牌标签,作为副标题或国际化保留 */
  brand?: string;
  /** API Base URL(OpenAI 兼容协议根路径,v1 结尾) */
  baseUrl: string;
  /** 默认 Model 名(provider 切换时若用户未指定则使用此值) */
  defaultModel: string;
  /** 是否需要 API Key(ollama 等本地模型无需 key) */
  requiresKey: boolean;
  /** 对应 .env 变量名(如 DEEPSEEK_API_KEY),持久化时使用 */
  envKeyName: string;
  /** 申请 API Key 的官方链接(用于引导弹窗"去获取 →",可空) */
  keyUrl?: string;
  /**
   * 推荐 Model 列表(用于设置页 model datalist,方便用户直接下拉选用)
   * - 取首个元素作为 defaultModel
   */
  suggestedModels: string[];
  /**
   * 是否需要通过 extra_body.thinking.type='disabled' 强制关闭"思考模式"
   * (针对 DeepSeek V4 等默认开启思考、content 会为空导致 JSON 解析失败的情况)
   * 其他国产模型(GLM / Qwen / Kimi / Yi)暂无此问题,无需处理
   */
  supportsThinkingDisable?: boolean;
}

export const LLM_PROVIDERS: readonly LlmProviderMeta[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    brand: '深度求索',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    requiresKey: true,
    envKeyName: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder', 'deepseek-v3'],
    supportsThinkingDisable: true,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    brand: 'Zhipu BigModel',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    requiresKey: true,
    envKeyName: 'ZHIPU_API_KEY',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-key',
    suggestedModels: ['glm-4-flash', 'glm-4-air', 'glm-4-airx', 'glm-4', 'glm-4-plus'],
  },
  {
    id: 'qwen',
    label: '通义千问',
    brand: 'Qwen DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-turbo',
    requiresKey: true,
    envKeyName: 'QWEN_API_KEY',
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    suggestedModels: [
      'qwen-turbo',
      'qwen-plus',
      'qwen-max',
      'qwen-long',
      'qwen2.5-72b-instruct',
    ],
  },
  {
    id: 'moonshot',
    label: 'Kimi (月之暗面)',
    brand: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    requiresKey: true,
    envKeyName: 'MOONSHOT_API_KEY',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    suggestedModels: [
      'moonshot-v1-8k',
      'moonshot-v1-32k',
      'moonshot-v1-128k',
      'kimi-k2-0711-preview',
    ],
  },
  {
    id: 'yi',
    label: '零一万物 Yi',
    brand: 'Lingyiwanwu',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    defaultModel: 'yi-large',
    requiresKey: true,
    envKeyName: 'YI_API_KEY',
    keyUrl: 'https://platform.lingyiwanwu.com/apikeys',
    suggestedModels: ['yi-large', 'yi-medium', 'yi-spark', 'yi-large-rag', 'yi-large-turbo'],
  },
  {
    id: 'MiniMax',
    label: 'MiniMax',
    brand: 'MiniMax',
    baseUrl: 'https://api.MiniMax.chat/v1',
    // 推荐 pro 模型:高质量 / 中文友好
    defaultModel: 'MiniMax-Text-01',
    requiresKey: true,
    envKeyName: 'MINIMAX_API_KEY',
    keyUrl: 'https://platform.MiniMax.io/user-center/basic-information/interface-key',
    suggestedModels: [
      'MiniMax-Text-01',
      'MiniMax-Text-01-240628',
      'abab6.5s-chat',
      'abab6.5-chat',
      'abab5.5-chat',
    ],
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    brand: 'Tencent Hunyuan',
    baseUrl: 'https://api.hunyuan.tencent.com/v1',
    defaultModel: 'hunyuan-standard',
    requiresKey: true,
    envKeyName: 'HUNYUAN_API_KEY',
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    suggestedModels: [
      'hunyuan-standard',
      'hunyuan-standard-256K',
      'hunyuan-pro',
      'hunyuan-turbo',
      'hunyuan-turbos',
      'hunyuan-code',
    ],
  },
  {
    id: 'sensenova',
    label: '商汤日日新',
    brand: 'SenseTime SenseChat',
    baseUrl: 'https://api.sensenova.cn/compatible-mode/v1',
    defaultModel: 'SenseChat-5',
    requiresKey: true,
    envKeyName: 'SENSENOVA_API_KEY',
    keyUrl: 'https://platform.sensenova.cn/docManage',
    suggestedModels: ['SenseChat-5', 'SenseChat-5-Coder', 'SenseChat-Character', 'SenseChat-Vision'],
  },
  {
    id: 'stepfun',
    label: '阶跃星辰',
    brand: 'StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    defaultModel: 'step-1v-8k',
    requiresKey: true,
    envKeyName: 'STEPFUN_API_KEY',
    keyUrl: 'https://platform.stepfun.ai/',
    suggestedModels: [
      'step-1v-8k',
      'step-1v-32k',
      'step-1v-128k',
      'step-1-8k',
      'step-1-32k',
      'step-2-mini',
    ],
  },
  // ---- 原有 Provider(保留向后兼容) ----
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true,
    envKeyName: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    requiresKey: false,
    envKeyName: 'OLLAMA_BASE_URL',
    suggestedModels: ['llama3.1', 'qwen2', 'deepseek-r1', 'mistral'],
  },
] as const;

/**
 * 按 id 索引,给 SettingsService / config.ts 等内部模块使用
 */
const PROVIDER_INDEX: ReadonlyMap<LlmProviderId, LlmProviderMeta> = new Map(
  LLM_PROVIDERS.map((p) => [p.id, p])
);

/** 根据 id 取出 provider 元数据;未知 id(如 enum 输入校验失败)返回 undefined */
export function getLlmProvider(id: LlmProviderId): LlmProviderMeta | undefined {
  return PROVIDER_INDEX.get(id);
}

/** 列出所有 provider id 字面量,用于 zod enum 等动态校验 */
export const ALL_LLM_PROVIDER_IDS = LLM_PROVIDERS.map((p) => p.id) as LlmProviderId[];

/**
 * 提供一个默认模型(provider 切换时若新 provider 没有当前 model,可提供一个兜底)
 */
export function defaultModelFor(id: LlmProviderId): string {
  return getLlmProvider(id)?.defaultModel ?? 'deepseek-chat';
}

/**
 * 给后端 zod 用:动态枚举(包含所有支持的 provider id 字面量)
 */
export const llmProviderEnum = ALL_LLM_PROVIDER_IDS;
