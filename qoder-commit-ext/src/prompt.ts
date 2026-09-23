import * as vscode from 'vscode';

/** 内置默认提示词：提示词文件与 settings 均未配置时的兜底 */
export const DEFAULT_PROMPT = `你是 Git 提交信息生成器。请根据提供的暂存区变更（文件列表与 diff）生成一条 commit message，严格遵守：

1. 格式：\`<type>(<scope>): <中文描述>\`；type 仅允许 feat / fix / refactor / perf / test / chore / docs
2. scope 取自受影响的模块或目录，无法判断时可省略
3. 标题不超过 50 个字符
4. 若变更较复杂，标题后空一行，再用 \`- \` 要点列出关键变更（最多 5 条）
5. 可参考"最近提交"一节，保持与仓库既有风格一致
6. 只输出 commit message 本身：不要解释、不要 Markdown 代码块、不要引号`;

/** 提示词文件在工作区中的位置 */
export function promptFileUri(): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return undefined;
  }
  const rel = vscode.workspace.getConfiguration('qoderCommit').get<string>(
    'promptFile',
    '.qoder/commit-prompt.md'
  );
  return vscode.Uri.joinPath(folder.uri, rel);
}

/**
 * 提示词加载优先级：
 * 1. 工作区提示词文件（默认 .qoder/commit-prompt.md，可随 Git 共享给团队）
 * 2. settings 中的 qoderCommit.prompt
 * 3. 内置默认提示词
 */
export async function loadPrompt(): Promise<string> {
  const uri = promptFileUri();
  if (uri) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder('utf-8').decode(bytes).trim();
      if (text) {
        return text;
      }
    } catch {
      // 文件不存在时继续走 settings / 内置默认
    }
  }
  const inline = vscode.workspace.getConfiguration('qoderCommit').get<string>('prompt', '').trim();
  return inline || DEFAULT_PROMPT;
}

/** 打开提示词文件；不存在时以默认模板创建 */
export async function openOrCreatePromptFile(): Promise<void> {
  const uri = promptFileUri();
  if (!uri) {
    vscode.window.showWarningMessage('请先打开一个工作区（文件夹）再使用该命令');
    return;
  }
  try {
    await vscode.workspace.fs.readFile(uri);
  } catch {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(`${DEFAULT_PROMPT}\n`, 'utf8'));
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}
