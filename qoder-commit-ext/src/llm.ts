import * as vscode from 'vscode';

export interface ModelCall {
  systemPrompt: string;
  userContent: string;
}

/** 密钥缺失专用错误：便于上层弹出“输入密钥”入口而不是普通报错 */
export class ApiKeyMissingError extends Error {
  constructor() {
    super('未找到 API 密钥');
    this.name = 'ApiKeyMissingError';
  }
}

/** SecretStorage 引用，由 activate 时注入 */
let secrets: vscode.SecretStorage | undefined;

export function initSecrets(storage: vscode.SecretStorage): void {
  secrets = storage;
}

/** 弹出密码输入框，把密钥安全地存入 SecretStorage */
export async function promptAndStoreApiKey(): Promise<boolean> {
  const key = await vscode.window.showInputBox({
    title: '配置模型 API 密钥',
    prompt: '当前使用 OpenAI 兼容接口（见设置 qoderCommit.apiUrl / qoderCommit.model）',
    password: true,
    ignoreFocusOut: true,
    placeHolder: '例如 DashScope 的 sk-xxx',
  });
  if (!key || !key.trim()) {
    return false;
  }
  if (secrets) {
    await secrets.store('apiKey', key.trim());
  }
  return true;
}

/** 外部 OpenAI 兼容 API（自定义提示词 + 自备密钥） */
export async function callModel(call: ModelCall): Promise<string> {
  const cfg = vscode.workspace.getConfiguration('qoderCommit');
  const apiUrl = (cfg.get<string>('apiUrl', '') || '').replace(/\/+$/, '');
  if (!apiUrl) {
    throw new Error('未配置 qoderCommit.apiUrl');
  }
  // 密钥优先级：SecretStorage（本扩展“输入密钥”入口存的）> settings > 环境变量
  const storedKey = secrets ? await secrets.get('apiKey') : undefined;
  const apiKey =
    storedKey ||
    cfg.get<string>('apiKey', '') ||
    process.env.DASHSCOPE_API_KEY ||
    process.env.QODER_COMMIT_API_KEY ||
    '';
  if (!apiKey) {
    throw new ApiKeyMissingError();
  }
  const model = cfg.get<string>('model', 'qwen-plus');

  const resp = await fetch(`${apiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: call.systemPrompt },
        { role: 'user', content: call.userContent },
      ],
    }),
  });

  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    throw new Error(`模型接口返回 ${resp.status}: ${detail}`);
  }
  const data = (await resp.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('模型未返回有效内容');
  }
  return cleanOutput(content);
}

/** 清理模型输出：去掉代码块围栏与整体包裹引号 */
export function cleanOutput(text: string): string {
  let t = text.trim();
  t = t.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  t = t.replace(/^"([\s\S]*)"$/, '$1');
  t = t.replace(/^“([\s\S]*)”$/, '$1');
  return t.trim();
}
