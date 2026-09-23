import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { cleanOutput } from './llm';
import { GitRepositoryLike } from './git';

/** Qoder CLI 未安装时的专用错误，便于上层给出针对性动作 */
export class QoderCliMissingError extends Error {
  constructor() {
    super('未找到 Qoder CLI');
    this.name = 'QoderCliMissingError';
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * 解析 Qoder CLI 可执行文件路径（与 ~/.qoder-cn/entry/qodercn-dispatcher.ps1 的查找规则对齐）：
 * 1. 设置 qoderCommit.cliPath
 * 2. 环境变量 QODERCN_CLI_BIN
 * 3. ~/.qoder-cn/bin/qoderclicn/qoderclicn.exe（CLI 官方安装位置）
 * 4. PATH 上的 qoderclicn.exe / qodercn.exe（仅 .exe，可直接 spawn，无 shell 长度限制）
 */
export function resolveQoderCli(): string | undefined {
  const cfg = vscode.workspace.getConfiguration('qoderCommit');
  const configured = cfg.get<string>('cliPath', '').trim();
  const candidates: string[] = [];
  if (configured) {
    candidates.push(configured);
  }
  if (process.env.QODERCN_CLI_BIN) {
    candidates.push(process.env.QODERCN_CLI_BIN);
  }
  candidates.push(
    path.join(os.homedir(), '.qoder-cn', 'bin', 'qoderclicn', 'qoderclicn.exe')
  );
  for (const c of candidates) {
    if (fileExists(c)) {
      return c;
    }
  }

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of ['qoderclicn.exe', 'qodercn.exe']) {
    for (const dir of pathDirs) {
      const full = path.join(dir, name);
      if (fileExists(full)) {
        return full;
      }
    }
  }
  return undefined;
}

/** npm .cmd shim 中解析出 node 入口脚本，避免经 cmd.exe 转发（8191 字符限制 + 引号转义问题） */
function resolveNpmShimEntry(cmdPath: string): { node: string; script: string } | undefined {
  try {
    const head = fs.readFileSync(cmdPath, 'utf8').split(/\r?\n/).slice(0, 40).join('\n');
    const withNode = head.match(/"([^"]*node(?:\.exe)?)"\s+"([^"]+\.js)"/);
    if (withNode) {
      return { node: withNode[1], script: withNode[2] };
    }
    const plain = head.match(/node\s+"([^"]+\.js)"/);
    if (plain) {
      return { node: 'node', script: plain[1] };
    }
  } catch {
    // 解析失败走不到这里之外的处理
  }
  return undefined;
}

/** 用 Qoder CLI 无头模式生成提交信息：使用 IDE 同一登录账号的自家模型 */
export async function runQoderCli(
  systemPrompt: string,
  userContent: string,
  cwd: string
): Promise<string> {
  const cfg = vscode.workspace.getConfiguration('qoderCommit');
  const timeoutMs = cfg.get<number>('cliTimeout', 180) * 1000;
  const model = cfg.get<string>('cliModel', '').trim();

  let exe = resolveQoderCli();
  let spawnTarget: string;
  let baseArgs: string[];

  if (exe && exe.toLowerCase().endsWith('.cmd')) {
    const entry = resolveNpmShimEntry(exe);
    if (entry) {
      spawnTarget = entry.node;
      baseArgs = [entry.script];
    } else {
      throw new Error(
        `Qoder CLI shim 无法解析（${exe}），请在设置 qoderCommit.cliPath 中直接指定 .exe 或 node 脚本路径`
      );
    }
  } else {
    if (!exe) {
      throw new QoderCliMissingError();
    }
    spawnTarget = exe;
    baseArgs = [];
  }

  // CreateProcess 命令行上限约 32k 字符，预留开销后截断
  const maxTotal = 26000;
  let prompt = `${systemPrompt}\n\n${userContent}`;
  if (prompt.length > maxTotal) {
    prompt = `${prompt.slice(0, maxTotal)}\n（内容超长，已截断）`;
  }

  const args = [
    ...baseArgs,
    '-p',
    '--output-format',
    'text',
    '--tools',
    '',
    '--no-session-persistence',
    '--max-turns',
    '1',
    // 指定模型（如 Qwen3.8-Max / auto）；留空时用账号默认（通常为 auto 智能路由）
    ...(model ? ['-m', model] : []),
    prompt,
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(spawnTarget, args, {
      cwd,
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`Qoder CLI 超时（${timeoutMs / 1000}s）`));
      }
    }, timeoutMs);

    child.stdout.on('data', d => (stdout += d.toString()));
    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('error', err => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`启动 Qoder CLI 失败：${err.message}`));
      }
    });
    child.on('close', code => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const text = cleanOutput(stdout);
      if (code === 0 && text) {
        resolve(text);
        return;
      }
      const reason = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300);
      reject(new Error(`Qoder CLI 退出码 ${code}${reason ? `：${reason}` : ''}`));
    });
  });
}

/** native 结果按配置裁剪：nativeFirstLineOnly 开启时只保留第一行 */
function maybeFirstLineOnly(text: string): string {
  const firstLineOnly = vscode.workspace
    .getConfiguration('qoderCommit')
    .get<boolean>('nativeFirstLineOnly', true);
  if (!firstLineOnly) {
    return text;
  }
  return text.split(/\r?\n/, 1)[0].trim();
}

/**
 * 走 Qoder 内置提交信息管道（与原生按钮同一链路，使用 Qoder 自家模型，提示词为服务端内置）：
 * 1. 优先 vscode.aicoding RPC（git.generateCommitMessage，返回 message 由我们写入输入框）
 * 2. 回退执行内置命令（内置流程自己流式写入输入框）
 * 是否只保留第一行由 qoderCommit.nativeFirstLineOnly 控制。
 */
export async function runNativeGeneration(
  repo: GitRepositoryLike
): Promise<{ message: string; wroteInputBox: boolean }> {
  const aicoding = (vscode as any).aicoding;
  if (aicoding && typeof aicoding.sendRequest === 'function') {
    try {
      const result = await aicoding.sendRequest('git.generateCommitMessage', {
        rootUri: repo.rootUri.toString(),
      });
      const msg =
        typeof result?.message === 'string' ? maybeFirstLineOnly(cleanOutput(result.message)) : '';
      if (msg) {
        return { message: msg, wroteInputBox: false };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NOT_LOGGED_IN')) {
        throw new Error('Qoder 未登录，请先在 IDE 中登录 Qoder 账号');
      }
      // 其他错误回退到内置命令再试一次
    }
  }

  await vscode.commands.executeCommand(
    'aicoding.command.generateCommitMessage',
    repo.rootUri
  );
  // 开启裁剪时：原生流程在命令结束时才把最终文本防抖写入输入框，稍候再裁剪为第一行
  if (
    vscode.workspace.getConfiguration('qoderCommit').get<boolean>('nativeFirstLineOnly', true)
  ) {
    await new Promise(resolve => setTimeout(resolve, 600));
    const current = repo.inputBox.value;
    if (current.trim()) {
      repo.inputBox.value = maybeFirstLineOnly(cleanOutput(current));
    }
  }
  return { message: '', wroteInputBox: true };
}
