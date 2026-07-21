// IPC boundary contract. Documents the `window.api` surface exposed by preload.js
// and the result shapes returned by the main-process handlers, so editors/tsc can
// check renderer usage against a single source of truth. Not a runtime artifact.

/** A git/tool action result: ok on success, or an error message. */
export interface OpResult {
  ok?: boolean;
  /** git stdout worth showing the user (e.g. fetch/pull summary). */
  out?: string;
  /** human-readable failure message when the op did not succeed. */
  error?: string;
}

/** `worktree:remove` — distinguishes a hard git refusal from incomplete on-disk cleanup. */
export interface RemoveWorktreeResult extends OpResult {
  /** git removed the worktree but the folder could not be fully deleted (locked). */
  cleanupIncomplete?: boolean;
}

/** `git:delete-branch` — `cancelled` when the user declined the force-delete prompt. */
export interface DeleteBranchResult extends OpResult {
  cancelled?: boolean;
}

/** `git:diff` — success carries the raw diff text; failure carries an error message. */
export type DiffResult =
  | {
      ok: true;
      /** raw unified diff text (parsed by renderer/diff-parse.mjs). */
      diff: string;
      /** base ref the branch diff was computed against ('branch' mode only). */
      base?: string;
    }
  | {
      ok: false;
      error: string;
    };

export interface DiffStat {
  added: number;
  removed: number;
}

export interface Project {
  dir: string;
  name: string;
  isGit?: boolean;
  type?: 'node' | 'dotnet' | 'go' | 'rust' | 'python' | null;
}

export interface Worktree {
  path: string;
  branch: string | null;
  isMain?: boolean;
  dirty?: number;
  ahead?: number;
  behind?: number;
  upstream?: string | null;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

/** `branches:list` — local branches flagged for an existing worktree, remote branches
 * flagged for a matching local branch. No `worktrees` field (call `listWorktrees` separately). */
export interface BranchList {
  current: string | null;
  local: { name: string; hasWorktree: boolean }[];
  remote: { name: string; hasLocal: boolean }[];
}

/** `worktree:create` opts — `mode` selects the source; `base` only applies to `new`. */
export interface CreateWorktreeOpts {
  dir: string;
  mode: 'new' | 'local' | 'remote';
  branch: string;
  base?: string;
}

/** `worktree:create` — user cancelled the folder picker, or creation succeeded. */
export type CreateWorktreeResult = { canceled: true } | { error: string } | { path: string; branch: string };

/** `agent:spawn` opts — `resume` reopens a prior Claude session by id. */
export interface SpawnOpts {
  bypass?: boolean;
  resume?: string | null;
}

/** The object exposed as `window.api` (see preload.js). */
export interface Api {
  // projects
  listProjects(): Promise<Project[]>;
  addProject(): Promise<Project[]>;
  removeProject(dir: string): Promise<Project[]>;
  reorderProjects(dirs: string[]): Promise<Project[]>;

  // workspaces (scratch folders, no git)
  listWorkspaces(): Promise<Project[]>;
  /** Step 1: pick a folder for a new workspace (existing folders allowed). */
  pickWorkspaceFolder(): Promise<{ path?: string; canceled?: boolean }>;
  /** Step 2: register it. `useParent` uses the picked folder as-is; otherwise
   * `name` is created as a subfolder under `parent`. */
  createWorkspace(opts: {
    parent: string;
    name?: string;
    useParent?: boolean;
  }): Promise<{ dir?: string; canceled?: boolean; error?: string }>;
  removeWorkspace(dir: string): Promise<Project[]>;
  reorderWorkspaces(dirs: string[]): Promise<Project[]>;

  // worktrees
  listWorktrees(dir: string): Promise<Worktree[]>;
  listBranches(dir: string): Promise<BranchList>;
  createWorktree(opts: CreateWorktreeOpts): Promise<CreateWorktreeResult>;
  removeWorktree(dir: string, path: string, force?: boolean): Promise<RemoveWorktreeResult>;
  gitFetch(cwd: string): Promise<OpResult>;
  gitPull(cwd: string): Promise<OpResult>;
  gitDiffStat(cwd: string): Promise<DiffStat>;
  gitDiff(cwd: string, mode: 'wip' | 'branch'): Promise<DiffResult>;
  gitBranch(cwd: string): Promise<string | null>;
  gitDeleteBranch(dir: string, branch: string): Promise<DeleteBranchResult>;
  openExternal(url: string): Promise<void>;
  openInVS(cwd: string): Promise<OpResult>;
  openInVSCode(cwd: string): Promise<OpResult>;
  openInExplorer(cwd: string): Promise<OpResult>;

  // clipboard
  readClipboard(): string;
  writeClipboard(text: string): void;

  // logging (renderer -> main log file)
  log(level: LogLevel, args: unknown[]): void;

  // git-change watchers
  setWatchDirs(dirs: string[]): void;
  onGitChanged(cb: (payload: { dir: string | null }) => void): void;

  // agents
  spawn(id: string, cwd: string, opts: SpawnOpts): Promise<void>;
  sendInput(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): void;

  // streams (main -> renderer)
  onData(cb: (p: { id: string; data: string }) => void): void;
  /** exitCode is set on a natural pty exit; error is set when the spawn itself failed (never both). */
  onExit(cb: (p: { id: string; exitCode?: number; error?: string }) => void): void;
  onEvent(
    cb: (p: { agentId: string; status?: string; sessionId?: string; event?: string; message?: string }) => void
  ): void;
}

declare global {
  interface Window {
    api: Api;
  }
}
