import { useEffect, useRef } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useAccount } from "@/components/player/account";
import { nativeCall, usePlayer } from "@/lib/player";
import { initializeShortcuts, isPlaybackSpace, setShortcutDispatcher, type ShortcutAction } from "@/lib/shortcuts";

export function usePlaybackShortcuts(onError: (cause: unknown) => void) {
  const state = usePlayer();
  const account = useAccount();
  const action = useRef<(action: ShortcutAction) => void>(() => {});
  action.current = (name) => {
    if (!isTauri()) return;
    const current = state.index === null ? undefined : state.queue[state.index];
    let operation: Promise<unknown>;
    if (name === "volumeUp" || name === "volumeDown") operation = nativeCall("player_volume", { volume: Math.max(0, Math.min(1, state.volume + (name === "volumeUp" ? 0.05 : -0.05))) });
    else if (!current) return;
    else if (name === "like") {
      if (current.source.kind !== "netease" || !account.profile || !account.likesReady || account.likedIds.has(current.source.id)) return;
      operation = account.toggleLike(current.source.id);
    } else operation = nativeCall("player_action", { action: name === "toggle" ? (["playing", "buffering", "loading"].includes(state.status) ? "pause" : "resume") : name });
    void operation.catch(onError);
  };
  useEffect(() => {
    setShortcutDispatcher((name) => action.current(name));
    void initializeShortcuts().catch(onError);
    const keydown = (event: KeyboardEvent) => {
      if (!isTauri() || !isPlaybackSpace(event)) return;
      event.preventDefault(); action.current("toggle");
    };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("keydown", keydown); setShortcutDispatcher(() => {}); };
  }, [onError]);
}
