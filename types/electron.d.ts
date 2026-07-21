// Minimal stub of the electron surface preload.js uses, so the IPC-boundary
// typecheck resolves `require('electron')` WITHOUT installing electron (CI runs
// with no node_modules). tsconfig.typecheck.json maps "electron" here via paths.
// This is only for the boundary typecheck — the app uses the real electron.

import type {
  BranchList,
  CreateWorktreeResult,
  DeleteBranchResult,
  DiffResult,
  DiffStat,
  OpResult,
  Project,
  RemoveWorktreeResult,
  Worktree,
} from './ipc';

/**
 * Per-channel return-type map for `ipcRenderer.invoke`, hand-maintained against
 * the `ipcRenderer.invoke(channel, ...)` call sites in preload.js and the
 * corresponding main-process handler results documented on `Api` in ipc.d.ts.
 * This is what makes the boundary typecheck actually catch return-shape drift:
 * without it, `invoke` returning `any` would make every preload assignment
 * pass regardless of what the real handler returns.
 */
interface InvokeChannelMap {
  'projects:list': Project[];
  'projects:add': Project[];
  'projects:remove': Project[];
  'projects:reorder': Project[];
  'workspaces:list': Project[];
  'workspaces:create': { dir?: string; canceled?: boolean; error?: string };
  'workspaces:remove': Project[];
  'workspaces:reorder': Project[];
  'projects:worktrees': Worktree[];
  'branches:list': BranchList;
  'worktree:create': CreateWorktreeResult;
  'worktree:remove': RemoveWorktreeResult;
  'git:fetch': OpResult;
  'git:pull': OpResult;
  'git:diffstat': DiffStat;
  'git:diff': DiffResult;
  'git:branch': string | null;
  'git:delete-branch': DeleteBranchResult;
  'open-external': void;
  'vs:open': OpResult;
  'code:open': OpResult;
  'explorer:open': OpResult;
  'agent:spawn': void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export const ipcRenderer: {
  // Known channels resolve to their documented result shape (see InvokeChannelMap)
  // so preload's pass-throughs are checked against ipc.d.ts. Unlisted channels
  // fall back to `any`, matching electron's own permissive typing.
  invoke<K extends keyof InvokeChannelMap>(channel: K, ...args: any[]): Promise<InvokeChannelMap[K]>;
  invoke(channel: string, ...args: any[]): Promise<any>;
  send(channel: string, ...args: any[]): void;
  sendSync(channel: string, ...args: any[]): any;
  on(channel: string, listener: (event: any, ...args: any[]) => void): void;
};
export const contextBridge: {
  exposeInMainWorld(key: string, api: unknown): void;
};
export const clipboard: {
  readText(): string;
  writeText(text: string): void;
};
