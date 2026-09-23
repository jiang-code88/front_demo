import * as vscode from 'vscode';
import { GitRepositoryLike, StagedContext, collectStagedContext } from './git';
import { loadPrompt } from './prompt';
import { ApiKeyMissingError, callModel, promptAndStoreApiKey } from './llm';
import { resolveQoderCli, runNativeGeneration, runQoderCli } from './qoder';

type Channel = 'auto' | 'qoder' | 'native' | 'external';

/** 生成提交信息并写入 SCM 提交输入框（按 qoderCommit.channel 编排通道） */
export async function generateCommitMessage(repo: GitRepositoryLike): Promise<void> {
  try {
    await dispatch(repo);
  } catch (err) {
    vscode.window.showErrorMessage(
      `生成提交信息失败：${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function dispatch(repo: GitRepositoryLike): Promise<void> {
  const channel = vscode.workspace.getConfiguration('qoderCommit').get<Channel>(
    'channel',
    'auto'
  );

  if (channel === 'native') {
    await runNative(repo, channel);
    return;
  }
  if (channel === 'external') {
    await runExternal(repo);
    return;
  }

  // qoder / auto：优先 CLI（Qoder 自家模型 + 自定义提示词）
  if (resolveQoderCli()) {
    await runQoder(repo);
    return;
  }

  if (channel === 'auto') {
    // CLI 缺失时退回内置管道（Qoder 自家模型，但提示词为内置固定提示词）
    const usedNative = await runNative(repo, channel);
    if (usedNative) {
      vscode.window.setStatusBarMessage(
        'Qoder CLI 未安装：本次使用内置提交生成（内置提示词）。安装 CLI 后可应用自定义提示词',
        10000
      );
    }
    return;
  }

  // 显式选择 qoder 通道但 CLI 缺失：给出可操作动作
  const action = await vscode.window.showErrorMessage(
    '未找到 Qoder CLI：无法用自定义提示词调用 Qoder 自家模型',
    '使用内置生成（本次）',
    '查看 CLI 安装'
  );
  if (action === '使用内置生成（本次）') {
    await runNative(repo, 'qoder');
  } else if (action === '查看 CLI 安装') {
    vscode.env.openExternal(vscode.Uri.parse('https://qoder.cn'));
  }
}

/** CLI 通道：自定义提示词 + Qoder 登录账号的模型 */
async function runQoder(repo: GitRepositoryLike): Promise<void> {
  const ctx = await requireStagedContext(repo);
  if (!ctx) {
    return;
  }
  const message = await runQoderCli(
    await loadPrompt(),
    buildUserContent(ctx),
    repo.rootUri.fsPath
  );
  writeOrWarn(repo, message, ctx);
}

/** 外部 API 通道：自定义提示词 + 自备密钥 */
async function runExternal(repo: GitRepositoryLike): Promise<void> {
  const ctx = await requireStagedContext(repo);
  if (!ctx) {
    return;
  }
  let message: string;
  try {
    message = await callModel({
      systemPrompt: await loadPrompt(),
      userContent: buildUserContent(ctx),
    });
  } catch (err) {
    if (err instanceof ApiKeyMissingError) {
      const action = await vscode.window.showErrorMessage(
        '外部 API 通道未配置密钥（当前 channel=external）',
        '输入密钥…'
      );
      if (action === '输入密钥…' && (await promptAndStoreApiKey())) {
        vscode.window.setStatusBarMessage('密钥已保存，请重新点击生成按钮', 8000);
      }
      return;
    }
    throw err;
  }
  writeOrWarn(repo, message, ctx);
}

/**
 * 内置通道：复用 Qoder 原生“生成提交信息”管道（Qoder 自家模型，服务端固定提示词）。
 * 返回是否实际执行（未登录等错误时为 false，错误已提示）。
 */
async function runNative(repo: GitRepositoryLike, from: Channel): Promise<boolean> {
  try {
    const { message, wroteInputBox } = await runNativeGeneration(repo);
    if (!wroteInputBox && message) {
      repo.inputBox.value = message;
    }
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`内置提交生成失败（channel=${from}）：${msg}`);
    return false;
  }
}

/** 写入提交输入框；空结果与忽略/截断信息以状态栏提示 */
function writeOrWarn(repo: GitRepositoryLike, message: string, ctx: StagedContext): void {
  if (!message) {
    vscode.window.showWarningMessage('模型返回为空，未写入提交输入框');
    return;
  }
  repo.inputBox.value = message;
  if (ctx.ignored.length > 0) {
    vscode.window.setStatusBarMessage(
      `提交信息已生成；已忽略 ${ctx.ignored.length} 个文件（qoderCommit.ignoreFiles）`,
      6000
    );
  } else if (ctx.truncated) {
    vscode.window.setStatusBarMessage(
      '提交信息已生成；diff 超长已截断（qoderCommit.maxDiffChars）',
      6000
    );
  }
}

/** 暂存区前置检查：空/全部被过滤时给出提示并返回 undefined */
async function requireStagedContext(
  repo: GitRepositoryLike
): Promise<StagedContext | undefined> {
  const ctx = await collectStagedContext(repo.rootUri.fsPath);
  if (!ctx) {
    vscode.window.showWarningMessage('暂存区为空：请先暂存（git add）要提交的变更');
    return undefined;
  }
  if (ctx.files.length === 0) {
    vscode.window.showWarningMessage(
      `暂存的文件全部被忽略规则过滤（${ctx.ignored.join('、')}），可在设置 qoderCommit.ignoreFiles 中调整`
    );
    return undefined;
  }
  return ctx;
}

/** 组装用户消息：变更文件 + 最近提交 + diff */
function buildUserContent(ctx: StagedContext): string {
  const parts: string[] = [`# 变更文件\n${ctx.files.join('\n')}`];

  if (ctx.recentCommits.length > 0) {
    parts.push(`# 最近提交\n${ctx.recentCommits.join('\n')}`);
  }

  parts.push(`# Diff\n${ctx.diff}${ctx.truncated ? '\n（diff 超长，已截断）' : ''}`);
  return parts.join('\n\n');
}
