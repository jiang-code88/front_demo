import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const run = promisify(exec);

/** 内置 Git 扩展 API 暴露的仓库对象（只依赖我们实际用到的字段） */
export interface GitRepositoryLike {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}

/** 暂存区上下文，喂给模型用的全部素材 */
export interface StagedContext {
  files: string[];
  ignored: string[];
  diff: string;
  truncated: boolean;
  recentCommits: string[];
}

/** 获取内置 vscode.git 扩展的 API（可能未激活，需要先 activate） */
export async function getGitApi(): Promise<any | undefined> {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext) {
    return undefined;
  }
  try {
    if (!ext.isActive) {
      await ext.activate();
    }
    const exports = ext.exports as any;
    return typeof exports?.getAPI === 'function' ? exports.getAPI(1) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 解析命令的目标仓库：
 * 1. scm/title 菜单按钮传入的 SourceControl（带 rootUri）优先；
 * 2. 单仓库工作区直接取第一个；
 * 3. 多仓库时弹出选择。
 */
export async function pickRepository(arg?: unknown): Promise<GitRepositoryLike | undefined> {
  const api = await getGitApi();
  const repositories: GitRepositoryLike[] = api?.repositories ?? [];
  if (repositories.length === 0) {
    return undefined;
  }

  const rootFromArg = (arg as { rootUri?: vscode.Uri } | undefined)?.rootUri?.toString();
  if (rootFromArg) {
    const hit = repositories.find(r => r.rootUri.toString() === rootFromArg);
    if (hit) {
      return hit;
    }
  }

  if (repositories.length === 1) {
    return repositories[0];
  }

  const picked = await vscode.window.showQuickPick(
    repositories.map(r => ({
      label: r.rootUri.path.split('/').pop() || r.rootUri.fsPath,
      description: r.rootUri.fsPath,
      repository: r,
    })),
    { placeHolder: '选择要生成提交信息的仓库' }
  );
  return picked?.repository;
}

/** 简单 glob 匹配：* 匹配单层路径段，** 跨目录 */
function matchesPattern(file: string, pattern: string): boolean {
  const normalized = file.replace(/\\/g, '/');
  if (!pattern.includes('*')) {
    return normalized === pattern || normalized.endsWith(`/${pattern}`);
  }
  const regexSrc = pattern
    .split('/')
    .map(segment =>
      segment
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '\u0000')
        .replace(/\*/g, '[^/]*')
        .replace(/\u0000/g, '.*')
    )
    .join('/');
  try {
    return new RegExp(`^${regexSrc}$`).test(normalized);
  } catch {
    return false;
  }
}

/** 按 "diff --git" 边界拆分 diff，剔除命中忽略规则的文件段落 */
function filterDiffSections(diff: string, isIgnored: (file: string) => boolean): string {
  if (!diff) {
    return '';
  }
  const sections = diff.split(/(?=^diff --git )/m);
  return sections
    .filter(section => {
      const m = section.match(/^diff --git a\/(\S+) b\//);
      // 解析不出路径时保守保留该段
      return !m || !isIgnored(m[1]);
    })
    .join('');
}

/** 收集暂存区素材：文件列表、过滤后的 diff、最近提交风格参考 */
export async function collectStagedContext(cwd: string): Promise<StagedContext | undefined> {
  const cfg = vscode.workspace.getConfiguration('qoderCommit');
  const ignoreFiles = cfg.get<string[]>('ignoreFiles', []);
  const maxDiffChars = cfg.get<number>('maxDiffChars', 30000);
  const recentCount = cfg.get<number>('includeRecentCommits', 5);

  const [{ stdout: namesRaw }, { stdout: diffRaw }] = await Promise.all([
    run('git diff --cached --name-only -z', { cwd, maxBuffer: 64 * 1024 * 1024 }),
    run('git diff --cached', { cwd, maxBuffer: 64 * 1024 * 1024 }),
  ]);
  const names = namesRaw.split('\0').filter(Boolean);
  if (names.length === 0) {
    return undefined;
  }

  const isIgnored = (f: string) => ignoreFiles.some(p => matchesPattern(f, p));
  const ignored = names.filter(isIgnored);
  const files = names.filter(f => !isIgnored(f));
  if (files.length === 0) {
    return { files, ignored, diff: '', truncated: false, recentCommits: [] };
  }

  const filteredDiff = filterDiffSections(diffRaw, isIgnored);
  const truncated = filteredDiff.length > maxDiffChars;

  let recentCommits: string[] = [];
  if (recentCount > 0) {
    try {
      const { stdout } = await run(`git log --oneline -n ${recentCount}`, {
        cwd,
        maxBuffer: 1024 * 1024,
      });
      recentCommits = stdout.split('\n').filter(Boolean);
    } catch {
      // 历史记录不可用时忽略，不影响生成
    }
  }

  return {
    files,
    ignored,
    diff: truncated ? filteredDiff.slice(0, maxDiffChars) : filteredDiff,
    truncated,
    recentCommits,
  };
}
