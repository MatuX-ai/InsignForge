/**
 * 前端 LLM Provider 注册表(UI 元数据)
 *
 * 与 backend/src/services/llm/providers.ts 后端注册表保持一一对应,
 * 用于:
 * - Settings 页 Provider 下拉选项
 * - OnboardingModal 首次启动 Provider 选择
 * - "去获取 API Key →" 提示链接
 *
 * 注意:前端这份元数据用于纯展示,不参与 LLM 请求。请求配置完全由后端
 * /api/v1/settings/llm 接口返回的 LlmStatus 驱动。当后端注册表新增 Provider
 * 时,需同步在此文件添加对应展示数据。
 */
export type LlmProviderId =
  | 'deepseek'
  | 'openai'
  | 'ollama'
  // 国产大模型(OpenAI 兼容协议)
  | 'zhipu'      // 智谱 BigModel / GLM-5
  | 'qwen'       // 通义千问 DashScope
  | 'moonshot'   // 月之暗面 Kimi
  | 'yi'         // 零一万物
  | 'MiniMax'      // MiniMax MiniMax
  | 'hunyuan'    // 腾讯混元
  | 'sensenova'  // 商汤日日新 V6
  | 'stepfun';   // 阶跃星辰 Step-2

export interface LlmProviderMeta {
  id: LlmProviderId;
  /** 中文标签(下拉主要文案) */
  label: string;
  /** 品牌/英文名(下拉副标题) */
  brand?: string;
  /** 简短一行描述 */
  description: string;
  /** 是否需要 API Key */
  requiresKey: boolean;
  /** 申请 API Key 的官方链接 */
  keyUrl?: string;
  /** 推荐 Model 列表(用于设置页 model datalist) */
  suggestedModels: string[];
  /** 默认 Model(provider 切换后无指定 model 时使用) */
  defaultModel: string;
}

export const LLM_PROVIDERS: readonly LlmProviderMeta[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek (推荐)',
    brand: '深度求索',
    description: '中文友好、长上下文、性价比高',
    requiresKey: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    suggestedModels: [
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
    ],
    defaultModel: 'deepseek-v4-pro',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    brand: 'Zhipu BigModel',
    description: '清华系 GLM-5 旗舰,编程能力对齐 Claude Opus 4.5',
    requiresKey: true,
    keyUrl: 'https://bigmodel.cn/usercenter/proj-key',
    suggestedModels: [
      'glm-5',
      'glm-5.1',
      'glm-5.2',
      'glm-4.7-flash',
      'glm-z1',
    ],
    defaultModel: 'glm-5',
  },
  {
    id: 'qwen',
    label: '通义千问',
    brand: 'Qwen DashScope',
    description: '阿里云 DashScope,Qwen3.8 旗舰,262K 上下文',
    requiresKey: true,
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    suggestedModels: [
      'qwen3.8-max',
      'qwen3.8-flash',
      'qwen3.7-max',
      'qwen3.7-plus',
      'qwen3.7-flash',
    ],
    defaultModel: 'qwen3.8-max',
  },
  {
    id: 'moonshot',
    label: 'Kimi (月之暗面)',
    brand: 'Moonshot',
    description: 'Kimi K3 旗舰 1M 上下文,适合报告/长文档生成',
    requiresKey: true,
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    suggestedModels: [
      'kimi-k3',
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
      'kimi-k2.6',
    ],
    defaultModel: 'kimi-k3',
  },
  {
    id: 'yi',
    label: '零一万物 Yi',
    brand: 'Lingyiwanwu',
    description: '李开复旗下 Yi 系列,Yi-Large 千亿参数旗舰',
    requiresKey: true,
    keyUrl: 'https://platform.lingyiwanwu.com/apikeys',
    suggestedModels: [
      'yi-large',
      'yi-large-rag',
      'yi-large-turbo',
      'yi-medium',
      'yi-spark',
    ],
    defaultModel: 'yi-large',
  },
  {
    id: 'MiniMax',
    label: 'MiniMax',
    brand: undefined,
    description: 'MiniMax M 系列,中文质量 SOTA,适合报告类长文本生成',
    requiresKey: true,
    keyUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    // 与 backend/src/services/llm/providers.ts 中 MiniMax 保持一致
    // 来源:platform.minimaxi.com/docs/api-reference/api-overview(2026-08 拉取)
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
    defaultModel: 'MiniMax-M2',
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    brand: 'Tencent Hunyuan',
    description: '腾讯 TurboS 最新一代 MOE 旗舰,32K 上下文',
    requiresKey: true,
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    suggestedModels: [
      'hunyuan-turbos-latest',
      'hunyuan-2.0-thinking',
      'hunyuan-t1',
    ],
    defaultModel: 'hunyuan-turbos-latest',
  },
  {
    id: 'sensenova',
    label: '商汤日日新',
    brand: 'SenseTime SenseChat',
    description: '商汤 V6 多模态旗舰 6200 亿参数,原生多模态架构',
    requiresKey: true,
    keyUrl: 'https://platform.sensenova.cn/docManage',
    suggestedModels: [
      'sensenova-v6-pro',
      'sensenova-v6-reasoner',
      'sensenova-v6-omni',
      'sensenova-6.8-flash-lite',
    ],
    defaultModel: 'sensenova-v6-pro',
  },
  {
    id: 'stepfun',
    label: '阶跃星辰',
    brand: 'StepFun',
    description: 'Step-2 万亿参数 MoE 旗舰,单一端点支持文本/图像/音/视频',
    requiresKey: true,
    keyUrl: 'https://platform.stepfun.ai/',
    suggestedModels: [
      'step-2',
      'step-2-mini',
      'step-r',
      'step-1',
      'step-1.5v',
      'step-cc',
    ],
    defaultModel: 'step-2',
  },
  // ---- 国际/本地 Provider ----
  {
    id: 'openai',
    label: 'OpenAI',
    brand: 'GPT-5',
    description: '海外直连,GPT-5 旗舰,需要海外网络环境',
    requiresKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    suggestedModels: [
      'gpt-5',
      'gpt-5.1',
      'gpt-5-mini',
      'gpt-5-nano',
      'o3',
      'o4-mini',
    ],
    defaultModel: 'gpt-5',
  },
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    brand: '本地部署',
    description: '本地无需 Key,需先启动 Ollama 服务',
    requiresKey: false,
    suggestedModels: [
      'llama3.1',
      'qwen3',
      'qwen2.5',
      'deepseek-r1',
      'gemma3',
      'mistral',
      'phi4',
    ],
    defaultModel: 'llama3.1',
  },
] as const;

/**
 * 按 id 索引,缺省时返回 undefined(便于运行时容错判断)
 */
const PROVIDER_INDEX: ReadonlyMap<LlmProviderId, LlmProviderMeta> = new Map(
  LLM_PROVIDERS.map((p) => [p.id, p])
);

/** 根据 id 取 provider 元数据;不在前端注册表(如后端注册了新 provider 但前端未同步)返回 undefined */
export function getLlmProvider(id: string): LlmProviderMeta | undefined {
  return PROVIDER_INDEX.get(id as LlmProviderId);
}

/** 所有 provider id 列表(供下拉渲染用) */
export const ALL_LLM_PROVIDER_IDS = LLM_PROVIDERS.map((p) => p.id) as LlmProviderId[];

/** 给定 id 拿出默认 model;id 不在前端注册表时回退到 deepseek 的当前旗舰 deepseek-v4-pro */
export function defaultModelFor(id: string): string {
  return getLlmProvider(id)?.defaultModel ?? 'deepseek-v4-pro';
}
