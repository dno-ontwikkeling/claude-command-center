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

/** `agent:spawn` opts — `resume` reopens a prior Claude session by id. `cols`/`rows`
 * set the initial pty size (a phone spawn passes the phone's size; default 80x30). */
export interface SpawnOpts {
  bypass?: boolean;
  resume?: string | null;
  cols?: number;
  rows?: number;
}

/** One agent as mirrored to the phone (renderer -> main -> phone). */
export interface RemoteAgent {
  id: string;
  label: string;
  dir: string;
  cwd: string;
  branch: string | null;
  /** false for a separate worktree (its folder can be deleted); true otherwise */
  isMain: boolean;
  status: string;
  dormant: boolean;
}

/** `remote:agents` — renderer snapshot; `seq` increments per push within a renderer lifetime. */
export interface RemoteAgentsSnapshot {
  seq: number;
  list: RemoteAgent[];
}

/** `remote:command` — main asks the renderer to run a phone-initiated action. */
export type RemoteCommand =
  | { reqId: number; op: 'spawn'; args: { dir: string; cwd: string; cols: number; rows: number } }
  | { reqId: number; op: 'resume'; args: { id: string; cols?: number; rows?: number } }
  | { reqId: number; op: 'kill'; args: { id: string } };

/** `remote:command-result` — the renderer's answer; spawn/resume return the agent `{ id }`. */
export interface RemoteCommandResult {
  reqId: number;
  ok: boolean;
  result?: { id: string } | null;
  error?: string;
}

/** `remote:getConfig` and friends — settings plus live server state. `error` is a
 * listen failure, or a rejected setConfig patch. */
export interface RemoteConfig {
  enabled: boolean;
  port: number;
  bindHost: string;
  /** user override for the host in the pairing URL ('' = auto). */
  advertisedHost: string;
  /** the host the pairing URL will actually use. */
  effectiveHost: string;
  hostOptions: { address: string; iface: string; tailscale: boolean }[];
  status: 'off' | 'starting' | 'listening' | 'error';
  error: string | null;
  fingerprint: string | null;
  clients: { ip: string; since: number }[];
}

export interface RemoteConfigPatch {
  enabled?: boolean;
  port?: number;
  bindHost?: string;
  advertisedHost?: string;
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
  removeWorkspace(dir: string, opts?: { deleteFolder?: boolean }): Promise<{ workspaces: Project[]; error?: string }>;
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
  gitDeleteBranch(dir: string, branch: string, opts?: { noPrompt?: boolean }): Promise<DeleteBranchResult>;
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
  /** pty size ownership flipped (the phone resized it, or the desktop took it back). */
  onSizeOwner(cb: (p: { id: string; owner: 'desktop' | 'remote' }) => void): void;
  onProjectsChanged(cb: () => void): void;

  // remote access (phone app)
  getRemoteConfig(): Promise<RemoteConfig>;
  setRemoteConfig(patch: RemoteConfigPatch): Promise<RemoteConfig>;
  /** Rotate token + certificate; every paired phone must re-pair. */
  regenerateRemote(): Promise<RemoteConfig>;
  disconnectRemoteClients(): Promise<RemoteConfig>;
  /** The string the pairing QR encodes, while the server is listening. */
  getRemotePairing(): Promise<{ code?: string; qr?: string; url?: string; error?: string }>;
  pushRemoteAgents(snapshot: RemoteAgentsSnapshot): void;
  onRemoteCommand(cb: (cmd: RemoteCommand) => void): void;
  sendRemoteCommandResult(result: RemoteCommandResult): void;
}

declare global {
  interface Window {
    api: Api;
  }
}
