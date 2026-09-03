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
  | 'zhipu'      // 智谱 BigModel / GLM-5
  | 'qwen'       // 通义千问 DashScope(OpenAI 兼容模式)
  | 'moonshot'   // 月之暗面 Kimi
  | 'yi'         // 零一万物
  | 'MiniMax'      // MiniMax MiniMax
  | 'hunyuan'    // 腾讯混元
  | 'sensenova'  // 商汤日日新 SenseChat / V6
  | 'stepfun';   // 阶跃星辰 Step-2

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
    // 性能优先:V4-Pro 2026-08-13 正式版旗舰
    defaultModel: 'deepseek-v4-pro',
    requiresKey: true,
    envKeyName: 'DEEPSEEK_API_KEY',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    // 来源:api-docs.deepseek.com/updates(2026-08 拉取)
    // 旧的 deepseek-chat / deepseek-reasoner 已于 2026-07-24 停用,
    // deepseek-coder 不在售,以下为当前 V4 系列
    suggestedModels: [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
    ],
    supportsThinkingDisable: true,
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    brand: 'Zhipu BigModel',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    // 性能优先:GLM-5 2026-02-11 旗舰,编程能力对齐 Claude Opus 4.5
    defaultModel: 'glm-5',
    requiresKey: true,
    envKeyName: 'ZHIPU_API_KEY',
    keyUrl: 'https://bigmodel.cn/usercenter/proj-key',
    // 来源:bigmodel.cn / ofox.ai 2026-04 报道 + 阿里云百炼转售列表
    // GLM-5 是 2026 旗舰;GLM-4.7-Flash 免费;GLM-Z1 为推理系列
    suggestedModels: [
      'glm-5',
      'glm-5.1',
      'glm-5.2',
      'glm-4.7-flash',
      'glm-z1',
    ],
  },
  {
    id: 'qwen',
    label: '通义千问',
    brand: 'Qwen DashScope',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    // 性能优先:Qwen3.8-Max 2026-08 旗舰,262K 上下文
    defaultModel: 'qwen3.8-max',
    requiresKey: true,
    envKeyName: 'QWEN_API_KEY',
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    // 来源:help.aliyun.com/zh/model-studio/qwen-api-via-dashscope(2026-08-26 拉取)
    // 旧的 qwen-turbo / qwen-plus / qwen-max / qwen2.5-72b-instruct 将于 2026-10-10 下架,
    // 全部替换为 Qwen3.x 系列
    suggestedModels: [
      'qwen3.8-max',
      'qwen3.8-flash',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.7-flash',
    ],
  },
  {
    id: 'moonshot',
    label: 'Kimi (月之暗面)',
    brand: 'Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    // 性能优先:kimi-k3 2.8 万亿参数旗舰,1M 上下文
    defaultModel: 'kimi-k3',
    requiresKey: true,
    envKeyName: 'MOONSHOT_API_KEY',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    // 来源:platform.moonshot.cn/console/api-keys + 月之暗面 2026-08-04 公告
    // moonshot-v1-8k/32k/128k 已于 2026-08-31 下线,kimi-k2-0711-preview 是旧 preview,
    // 全部替换为 K2.5+ K2.6+ K2.7-code+ K3 系列
    suggestedModels: [
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
      'kimi-k2.6',
    ],
  },
  {
    id: 'yi',
    label: '零一万物 Yi',
    brand: 'Lingyiwanwu',
    baseUrl: 'https://api.lingyiwanwu.com/v1',
    // 性能优先:yi-large 千亿参数旗舰
    defaultModel: 'yi-large',
    requiresKey: true,
    envKeyName: 'YI_API_KEY',
    keyUrl: 'https://platform.lingyiwanwu.com/apikeys',
    // 来源:help.aliyun.com/zh/model-studio/yi-api(2026-05 拉取)
    // 零一万物模型名近两年未大改,当前仍为以上系列(yi-lightning / yi-vision 等
    // 社区提及过但官方 API 文档未确认,暂不收录以避免模型_not_found)
    suggestedModels: [
      'yi-large',
      'yi-large-rag',
      'yi-large-turbo',
      'yi-medium',
      'yi-spark',
    ],
  },
  {
    id: 'MiniMax',
    label: 'MiniMax',
    brand: 'MiniMax',
    // MiniMax 官方中国区 OpenAI 兼容端点(platform.minimaxi.com)
    baseUrl: 'https://api.minimaxi.com/v1',
    // 默认推荐 M2:专为高效编码与 Agent 工作流而生,个人版 MVP 性价比最值
    defaultModel: 'MiniMax-M2',
    requiresKey: true,
    envKeyName: 'MINIMAX_API_KEY',
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    // 来源:platform.minimaxi.com/docs/api-reference/api-overview(2026-08 拉取)
    // M2.7 起 MiniMax 全系改名为"M<版本>"驼峰命名,旧的 MiniMax-Text-01 / abab* 已下线
    suggestedModels: [
      'MiniMax-M2',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
      'MiniMax-M3',
    ],
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    brand: 'Tencent Hunyuan',
    baseUrl: 'https://api.hunyuan.tencent.com/v1',
    // 性能优先:Hunyuan-TurboS-latest 全新一代 MOE 旗舰
    defaultModel: 'hunyuan-turbos-latest',
    requiresKey: true,
    envKeyName: 'HUNYUAN_API_KEY',
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    // 来源:cloud.tencent.com/announce/detail/2305(2026-06-05 下架公告)
    // 旧 hunyuan-standard / standard-256K / pro / turbo / turbos-latest / role 等 9 个模型
    // 已于 2026-06-26 下架,hunyuan-code 未出现在售列表中
    suggestedModels: [
      'hunyuan-turbos-latest',
      'hunyuan-2.0-thinking',
      'hunyuan-t1',
    ],
  },
  {
    id: 'sensenova',
    label: '商汤日日新',
    brand: 'SenseTime SenseChat',
    // 商汤 2026 新的 Token Plan 入口(取代旧的 api.sensenova.cn)
    baseUrl: 'https://token.sensenova.cn/v1',
    // 性能优先:SenseNova V6 Pro 6200 亿参数旗舰
    defaultModel: 'sensenova-v6-pro',
    requiresKey: true,
    envKeyName: 'SENSENOVA_API_KEY',
    keyUrl: 'https://platform.sensenova.cn/docManage',
    // 来源:platform.sensenova.cn TokenPlan 大调整(2026-04-28) + V6 多模态融合发布会
    // 旧的 SenseChat-5/5-Coder/Character/Vision 已被 V6 系列全面取代
    suggestedModels: [
      'sensenova-v6-pro',
      'sensenova-v6-reasoner',
      'sensenova-v6-omni',
      'sensenova-6.8-flash-lite',
    ],
  },
  {
    id: 'stepfun',
    label: '阶跃星辰',
    brand: 'StepFun',
    baseUrl: 'https://api.stepfun.com/v1',
    // 性能优先:step-2 万亿参数 MoE 旗舰(单一端点支持文本/图像/音/视频)
    defaultModel: 'step-2',
    requiresKey: true,
    envKeyName: 'STEPFUN_API_KEY',
    keyUrl: 'https://platform.stepfun.ai/',
    // 来源:platform.stepfun.com/docs/zh/guides/models/text + apirank.vip 测评
    // 旧的 step-1v-8k/32k/128k 是 2024 年多模态 V 版本,不再是当前推荐;
    // step-1 是上代纯文本旗舰(仍然有效);step-r 为推理,step-cc 为代码补全
    suggestedModels: [
      'step-2',
      'step-2-mini',
      'step-r',
      'step-1',
      'step-1.5v',
      'step-cc',
    ],
  },
  // ---- 原有 Provider(保留向后兼容) ----
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    // 性能优先:gpt-5 2025-08-07 旗舰(上下文大、价格高,适合资金充裕个人用户)
    defaultModel: 'gpt-5',
    requiresKey: true,
    envKeyName: 'OPENAI_API_KEY',
    keyUrl: 'https://platform.openai.com/api-keys',
    // 来源:OpenAI 官方 2026-02-13 下线公告 + platform.openai.com/docs/models
    // 旧的 gpt-4o / gpt-4o-mini / gpt-4-turbo / gpt-3.5-turbo 全部下线
    suggestedModels: [
      'gpt-5',
      'gpt-5.1',
      'gpt-5-mini',
      'gpt-5-nano',
      'o3',
      'o4-mini',
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'llama3.1',
    requiresKey: false,
    envKeyName: 'OLLAMA_BASE_URL',
    // 来源:ollama.com/library(2026 热门模型)
    // Ollama 模型名可直接使用,ollama run <name> 会拉取 latest 标签;
    // 以下是 2026 热门本地推荐(中文能力优先 qwen3,推理优先 deepseek-r1)
    suggestedModels: [
      'llama3.1',
      'qwen3',
      'qwen2.5',
      'deepseek-r1',
      'gemma3',
      'mistral',
      'phi4',
    ],
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
 * 兜底值必须与 LLM_PROVIDERS[].defaultModel 中 deepseek 一致,避免回退到已停用模型
 */
export function defaultModelFor(id: LlmProviderId): string {
  return getLlmProvider(id)?.defaultModel ?? 'deepseek-v4-pro';
}

/**
 * 给后端 zod 用:动态枚举(包含所有支持的 provider id 字面量)
 */
export const llmProviderEnum = ALL_LLM_PROVIDER_IDS;
