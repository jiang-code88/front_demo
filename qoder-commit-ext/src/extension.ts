import * as vscode from 'vscode';
import { pickRepository } from './git';
import { generateCommitMessage } from './generator';
import { openOrCreatePromptFile } from './prompt';
import { initSecrets, promptAndStoreApiKey } from './llm';

export function activate(context: vscode.ExtensionContext): void {
  initSecrets(context.secrets);

  context.subscriptions.push(
    vscode.commands.registerCommand('qoderCommit.generate', async (arg?: unknown) => {
      const repo = await pickRepository(arg);
      if (!repo) {
        vscode.window.showWarningMessage('未找到 Git 仓库，无法生成提交信息');
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.SourceControl, title: '正在生成提交信息…' },
        () => generateCommitMessage(repo)
      );
    }),
    vscode.commands.registerCommand('qoderCommit.openPromptFile', () => openOrCreatePromptFile()),
    vscode.commands.registerCommand('qoderCommit.setApiKey', async () => {
      if (await promptAndStoreApiKey()) {
        vscode.window.setStatusBarMessage('API 密钥已保存', 6000);
      }
    })
  );
}

export function deactivate(): void {
  // 无需清理
}
