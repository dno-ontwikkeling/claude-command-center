// Minimal stub of the electron surface preload.js uses, so the IPC-boundary
// typecheck resolves `require('electron')` WITHOUT installing electron (CI runs
// with no node_modules). tsconfig.typecheck.json maps "electron" here via paths.
// This is only for the boundary typecheck — the app uses the real electron.

/* eslint-disable @typescript-eslint/no-explicit-any */
export const ipcRenderer: {
  // `any` mirrors electron's own permissive typing so preload's thin pass-throughs
  // (invoke -> typed Api result, on(cb)) check without over-constraining.
  invoke(channel: string, ...args: any[]): Promise<any>;
  send(channel: string, ...args: any[]): void;
  on(channel: string, listener: (event: any, ...args: any[]) => void): void;
};
export const contextBridge: {
  exposeInMainWorld(key: string, api: unknown): void;
};
export const clipboard: {
  readText(): string;
  writeText(text: string): void;
};
