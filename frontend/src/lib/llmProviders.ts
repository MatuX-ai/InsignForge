/**
 * 前端 LLM Provider 注册表(UI 元数据)
 *
 * 与 backend/src/services/llm/providers.ts 后端注册表保持一一对应,
 * 用于:
 * - Settings 页 Provider 下拉选项
 * - OnboardingModal 首次启动 Provider 选择
 * - "Provider 配置状态"面板
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
  | 'zhipu'      // 智谱 BigModel / GLM-4
  | 'qwen'       // 通义千问 DashScope
  | 'moonshot'   // 月之暗面 Kimi
  | 'yi'         // 零一万物
  | 'MiniMax'      // MiniMax MiniMax
  | 'hunyuan'    // 腾讯混元
  | 'sensenova'  // 商汤日日新
  | 'stepfun';   // 阶跃星辰

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
    suggestedModels: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder', 'deepseek-v3'],
    defaultModel: 'deepseek-chat',
  },
  {
    id: 'zhipu',
    label: '智谱 GLM',
    brand: 'Zhipu BigModel',
    description: '清华系 GLM-4 系列,中文对话与推理表现优秀',
    requiresKey: true,
    keyUrl: 'https://bigmodel.cn/usercenter/proj-key',
    suggestedModels: ['glm-4-flash', 'glm-4-air', 'glm-4-airx', 'glm-4', 'glm-4-plus'],
    defaultModel: 'glm-4-flash',
  },
  {
    id: 'qwen',
    label: '通义千问',
    brand: 'Qwen DashScope',
    description: '阿里云 DashScope,多尺寸模型(7B/72B)可选',
    requiresKey: true,
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    suggestedModels: [
      'qwen-turbo',
      'qwen-plus',
      'qwen-max',
      'qwen-long',
      'qwen2.5-72b-instruct',
    ],
    defaultModel: 'qwen-turbo',
  },
  {
    id: 'moonshot',
    label: 'Kimi (月之暗面)',
    brand: 'Moonshot',
    description: '200K 超长上下文,适合文档/报告类任务',
    requiresKey: true,
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
    suggestedModels: [
      'moonshot-v1-8k',
      'moonshot-v1-32k',
      'moonshot-v1-128k',
      'kimi-k2-0711-preview',
    ],
    defaultModel: 'moonshot-v1-8k',
  },
  {
    id: 'yi',
    label: '零一万物 Yi',
    brand: 'Lingyiwanwu',
    description: '李开复旗下,大参数开源闭源双线产品',
    requiresKey: true,
    keyUrl: 'https://platform.lingyiwanwu.com/apikeys',
    suggestedModels: ['yi-large', 'yi-medium', 'yi-spark', 'yi-large-rag', 'yi-large-turbo'],
    defaultModel: 'yi-large',
  },
  {
    id: 'MiniMax',
    label: 'MiniMax MiniMax',
    brand: 'MiniMax',
    description: 'MiniMax,不区分文本/多模态,SOTA 中文质量',
    requiresKey: true,
    keyUrl: 'https://platform.MiniMax.io/user-center/basic-information/interface-key',
    suggestedModels: [
      'MiniMax-Text-01',
      'MiniMax-Text-01-240628',
      'abab6.5s-chat',
      'abab6.5-chat',
    ],
    defaultModel: 'MiniMax-Text-01',
  },
  {
    id: 'hunyuan',
    label: '腾讯混元',
    brand: 'Tencent Hunyuan',
    description: '腾讯云全栈参规模,256K 长上下文选项',
    requiresKey: true,
    keyUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    suggestedModels: [
      'hunyuan-standard',
      'hunyuan-standard-256K',
      'hunyuan-pro',
      'hunyuan-turbo',
      'hunyuan-turbos',
      'hunyuan-code',
    ],
    defaultModel: 'hunyuan-standard',
  },
  {
    id: 'sensenova',
    label: '商汤日日新',
    brand: 'SenseTime SenseChat',
    description: '商汤大装置 SenseChat,多场景角色选项',
    requiresKey: true,
    keyUrl: 'https://platform.sensenova.cn/docManage',
    suggestedModels: ['SenseChat-5', 'SenseChat-5-Coder', 'SenseChat-Character', 'SenseChat-Vision'],
    defaultModel: 'SenseChat-5',
  },
  {
    id: 'stepfun',
    label: '阶跃星辰',
    brand: 'StepFun',
    description: '阶越星辰 Step-1/Step-2,128K 长上下文',
    requiresKey: true,
    keyUrl: 'https://platform.stepfun.ai/',
    suggestedModels: [
      'step-1v-8k',
      'step-1v-32k',
      'step-1v-128k',
      'step-1-8k',
      'step-1-32k',
      'step-2-mini',
    ],
    defaultModel: 'step-1v-8k',
  },
  // ---- 国际/本地 Provider ----
  {
    id: 'openai',
    label: 'OpenAI',
    brand: 'GPT-4o',
    description: '海外直连,需要海外网络环境',
    requiresKey: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    defaultModel: 'gpt-4o-mini',
  },
  {
    id: 'ollama',
    label: 'Ollama (本地)',
    brand: '本地部署',
    description: '本地无需 Key,需先启动 Ollama 服务',
    requiresKey: false,
    suggestedModels: ['llama3.1', 'qwen2', 'deepseek-r1', 'mistral'],
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

/** 给定 id 拿出默认 model;id 不在前端注册表时回退到 deepseek-chat(防误输入兜底) */
export function defaultModelFor(id: string): string {
  return getLlmProvider(id)?.defaultModel ?? 'deepseek-chat';
}
