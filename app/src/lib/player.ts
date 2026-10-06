import { invoke, isTauri, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

export type TrackSource = { kind: "netease"; id: number } | { kind: "local"; path: string; neteaseId: number | null };
export interface Track {
  key: string; title: string; artist: string; album: string;
  durationMs: number; cover: string; source: TrackSource;
}
export type PlaybackStatus = "stopped" | "loading" | "playing" | "paused" | "buffering" | "error";
export interface PlayerSnapshot {
  revision: number; queue: Track[]; index: number | null; status: PlaybackStatus;
  positionMs: number; durationMs: number; volume: number; deviceId: string | null;
  actualQuality: string | null; error: string | null; mediaError: string | null;
}
export interface Progress {
  revision: number; positionMs: number; durationMs: number; status: PlaybackStatus; receivedAt: number;
}
export interface Lyrics {
  source: "amll" | "netease" | "local"; format: "ttml" | "yrc" | "lrc";
  content: string; translation: string | null; romanization: string | null;
}
export interface OutputDevice { id: string; name: string }

let snapshot: PlayerSnapshot = { revision: 0, queue: [], index: null, status: "stopped", positionMs: 0,
  durationMs: 0, volume: 0.8, deviceId: null, actualQuality: null, error: null, mediaError: null };
let progress: Progress = { revision: 0, positionMs: 0, durationMs: 0, status: "stopped", receivedAt: 0 };
let updateSerial = 0;
const stateListeners = new Set<() => void>();
const progressListeners = new Set<() => void>();
const subscribeState = (listener: () => void) => { stateListeners.add(listener); return () => { stateListeners.delete(listener); }; };
const subscribeProgress = (listener: () => void) => { progressListeners.add(listener); return () => { progressListeners.delete(listener); }; };
export const usePlayer = () => useSyncExternalStore(subscribeState, () => snapshot);
const subscribeNothing = (_listener: () => void) => () => {};
export const useProgress = (enabled = true) => useSyncExternalStore(enabled ? subscribeProgress : subscribeNothing, () => progress);
export const getPlayer = () => snapshot;
export const getProgress = () => progress;

function updateProgress(value: Omit<Progress, "receivedAt">) {
  if (value.revision !== snapshot.revision) return;
  progress = { ...value, receivedAt: performance.now() };
  progressListeners.forEach((notify) => notify());
}

function updateState(value: PlayerSnapshot) {
  if (value.revision < snapshot.revision) return;
  snapshot = value;
  updateSerial++;
  updateProgress(value);
  stateListeners.forEach((notify) => notify());
}

export async function nativeCall<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("请在 NonsPlayer 桌面应用中使用此功能。");
  return invoke<T>(command, args);
}

export async function connectPlayer(): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  const listeners: UnlistenFn[] = [];
  try {
    listeners.push(await listen<PlayerSnapshot>("player-state", ({ payload }) => updateState(payload)));
    listeners.push(await listen<Omit<Progress, "receivedAt">>("player-progress", ({ payload }) => updateProgress(payload)));
    const serial = updateSerial;
    const initial = await nativeCall<PlayerSnapshot>("player_snapshot");
    if (serial === updateSerial) updateState(initial);
    return () => listeners.forEach((unlisten) => unlisten());
  } catch (error) { listeners.forEach((unlisten) => unlisten()); throw error; }
}

export function currentPosition(now = performance.now()): number {
  const advance = progress.status === "playing" ? Math.min(500, Math.max(0, now - progress.receivedAt)) : 0;
  return Math.round(Math.min(progress.durationMs || Number.MAX_SAFE_INTEGER, progress.positionMs + advance));
}

export function coverSource(cover: string): string | undefined {
  if (!cover) return undefined;
  if (cover.startsWith("https://") || cover.startsWith("http://")) return cover;
  return isTauri() ? convertFileSrc(cover) : undefined;
}

export function formatTime(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }

export const statusLabels: Record<PlaybackStatus, string> = { stopped: "已停止", loading: "正在加载", playing: "正在播放", paused: "已暂停", buffering: "正在缓冲", error: "播放失败" };
