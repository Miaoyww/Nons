import { isTauri } from "@tauri-apps/api/core";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { errorText } from "./player";

export const shortcutActions = [
  ["toggle", "播放/暂停音乐"], ["previous", "上一首"], ["next", "下一首"],
  ["like", "收藏此音乐"], ["volumeUp", "音量加"], ["volumeDown", "音量减"],
] as const;
export type ShortcutAction = typeof shortcutActions[number][0];
export type ShortcutSettings = { enabled: boolean; bindings: Record<ShortcutAction, string> };
const key = "nons-shortcut-settings";
const empty = (): ShortcutSettings => ({ enabled: false, bindings: { toggle: "", previous: "", next: "", like: "", volumeUp: "", volumeDown: "" } });
let settings = empty();
try {
  const saved = JSON.parse(localStorage.getItem(key) ?? "null");
  if (saved && typeof saved === "object") {
    settings.enabled = saved.enabled === true;
    for (const [action] of shortcutActions) {
      const value = saved.bindings?.[action];
      if (typeof value === "string" && value.length <= 100) settings.bindings[action] = value.trim();
    }
  }
} catch { /* Corrupt storage uses unbound defaults. */ }
let status = { settings, busy: false, error: undefined as string | undefined };
const listeners = new Set<() => void>();
const notify = () => { status = { ...status, settings }; listeners.forEach((fn) => fn()); };
export const getShortcutStatus = () => status;
export const subscribeShortcuts = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
let registered: string[] = [];
let dispatch: (action: ShortcutAction) => void = () => {};
export function setShortcutDispatcher(fn: (action: ShortcutAction) => void) { dispatch = fn; }
let initialized = false;
export async function initializeShortcuts() {
  if (initialized || !isTauri()) return;
  initialized = true;
  await saveShortcuts(settings, false);
}
export async function saveShortcuts(next: ShortcutSettings, persist = true) {
  if (status.busy) return false;
  status = { ...status, busy: true, error: undefined }; notify();
  const previous = settings;
  const cleaned = { enabled: next.enabled, bindings: { ...next.bindings } };
  for (const [action] of shortcutActions) cleaned.bindings[action] = cleaned.bindings[action].trim();
  async function install(value: ShortcutSettings) {
    if (!isTauri() || !value.enabled) return;
    for (const [action] of shortcutActions) {
      const binding = value.bindings[action];
      if (!binding) continue;
      await register(binding, (event) => { if (event.state === "Pressed") dispatch(action); });
      registered.push(binding);
    }
  }
  async function clear() {
    if (registered.length) await unregister(registered);
    registered = [];
  }
  try {
    const values = Object.values(cleaned.bindings).filter(Boolean).map((value) => value.toLowerCase());
    if (new Set(values).size !== values.length) throw new Error("同一快捷键不能用于多个操作。");
    await clear();
    await install(cleaned);
    if (persist) localStorage.setItem(key, JSON.stringify(cleaned));
    settings = cleaned;
    return true;
  } catch (cause) {
    status.error = `快捷键保存失败：${errorText(cause)}`;
    try { await clear(); if (persist) await install(previous); }
    catch (rollback) {
      status.error += `；恢复失败：${errorText(rollback)}。请重新保存。`;
      try { await clear(); } catch (cleanup) { status.error += `；解绑失败：${errorText(cleanup)}`; }
    }
    return false;
  } finally { status.busy = false; notify(); }
}

export function isPlaybackSpace(event: KeyboardEvent) {
  if (event.code !== "Space" || event.repeat || event.isComposing || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  // A global Space binding already receives the foreground key press.
  if (registered.some((binding) => binding.toLowerCase() === "space")) return false;
  const target = event.target;
  return !(target instanceof Element && target.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="combobox"], [role="menu"], [role="slider"], [role="checkbox"], [role="radio"], [role="switch"]'));
}
