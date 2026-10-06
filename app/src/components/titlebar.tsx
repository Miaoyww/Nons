import { useEffect, useRef, useState, type MouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { ChevronLeft, ChevronRight, Search, ChevronDown, Copy, Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { LoginDialog } from "@/components/player/login-dialog";
import { useMusicNavigation } from "@/components/player/music-navigation";
import appIcon from "@/assets/icon.png";

export function Titlebar({ playerMode = false, onBack }: { playerMode?: boolean; onBack?: () => void }) {
  const native = isTauri();
  const { page, navigate, back, forward, canBack, canForward } = useMusicNavigation();
  const [keyword, setKeyword] = useState(page.query);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => setKeyword(page.query), [page]);
  const [maximized, setMaximized] = useState(false);
  const [focused, setFocused] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!native) return;
    const appWindow = getCurrentWindow();
    let disposed = false;
    const listeners: UnlistenFn[] = [];
    const retain = (unlisten: UnlistenFn) => {
      if (disposed) unlisten();
      else listeners.push(unlisten);
    };
    const updateMaximized = async () => {
      const value = await appWindow.isMaximized();
      if (!disposed) setMaximized(value);
    };
    void updateMaximized().catch(console.error);
    void appWindow
      .isFocused()
      .then((value) => {
        if (!disposed) setFocused(value);
      })
      .catch(console.error);
    void appWindow
      .onResized(() => {
        void updateMaximized().catch(console.error);
      })
      .then(retain)
      .catch(console.error);
    void appWindow
      .onFocusChanged(({ payload }) => {
        if (!disposed) setFocused(payload);
      })
      .then(retain)
      .catch(console.error);
    return () => {
      disposed = true;
      listeners.forEach((unlisten) => unlisten());
    };
  }, [native]);

  async function windowAction(
    action: "minimize" | "toggleMaximize" | "close" | "startDragging",
  ) {
    if (!native) return;
    try {
      setError(null);
      const appWindow = getCurrentWindow();
      await appWindow[action]();
      if (action === "toggleMaximize")
        setMaximized(await appWindow.isMaximized());
    } catch (cause) {
      console.error("Window action failed", cause);
      setError("窗口操作失败，请重试。");
    }
  }

  function drag(event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    void windowAction(event.detail === 2 ? "toggleMaximize" : "startDragging");
  }

  return (
    <>
      <header
        className={`titlebar glass-surface relative z-10 h-12 shrink-0 select-none items-center ${playerMode ? "flex" : "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"}`}
        data-focused={focused}
      >
        <div className={`flex h-full min-w-0 ${playerMode ? "flex-1" : "items-center"}`}>
        <div
          className={`flex h-full min-w-0 gap-2.5 ${playerMode ? "items-start flex-1" : "items-center pl-4 pr-4"}`}
          onMouseDown={drag}
        >
          {playerMode ? <Button autoFocus variant="ghost" size="icon-lg" className="now-playing-back" aria-label="返回音乐" title="返回音乐" onMouseDown={(event) => event.stopPropagation()} onClick={onBack}><ChevronDown aria-hidden="true" /></Button> : <><img src={appIcon} alt="" className="size-7" draggable={false} />
          <span className="text-sm font-semibold">NonsPlayer</span></>}
        </div>

        {!playerMode && <>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="后退" disabled={!canBack} onClick={back}><ChevronLeft aria-hidden="true" /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="前进" disabled={!canForward} onClick={forward}><ChevronRight aria-hidden="true" /></Button>
          </div>
          <div className="h-full min-w-2 flex-1" onMouseDown={drag} />
        </>}
        </div>
        {!playerMode && <nav aria-label="音乐导航" className="flex shrink-0 items-center gap-1">
            {([['library', '音乐库'], ['discover', '发现'], ['local', '本地']] as const).map(([view, label]) => <Button key={view} variant={page.view === view || (view === 'library' && page.view === 'collection') || (view === 'discover' && page.view === 'search') ? 'secondary' : 'ghost'} aria-current={page.view === view || (view === 'library' && page.view === 'collection') || (view === 'discover' && page.view === 'search') ? 'page' : undefined} onClick={() => navigate(view)}>{label}</Button>)}
          </nav>}
        <div className="flex h-full min-w-0 items-center justify-end pl-3">
          {!playerMode && <div className="titlebar-search-slot mr-2"><form className="titlebar-search" onSubmit={(event) => { event.preventDefault(); if (keyword.trim()) navigate(page.view === 'local' ? 'local' : 'search', keyword.trim()); }}>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="展开音乐搜索" onClick={() => searchInput.current?.focus()}><Search aria-hidden="true" /></Button>
            <input ref={searchInput} aria-label={page.view === 'local' ? '搜索本地曲库' : '搜索网易云音乐'} placeholder={page.view === 'local' ? '搜索本地曲库' : '搜索网易云音乐'} value={keyword} maxLength={128} onChange={(event) => setKeyword(event.target.value)} />
          </form></div>}

        <div className="flex h-full shrink-0 items-center gap-1 pr-1.5">
          <div className={playerMode ? "hidden" : "flex items-center gap-1"}><LoginDialog /><SettingsDialog /></div>

          {!playerMode && <span className="mx-1.5 h-4 w-px bg-border" aria-hidden="true" />}
          <Button
            variant="ghost"
            size="icon-sm"
            className="titlebar-control"
            aria-label="最小化"
            title="最小化"
            disabled={!native}
            onClick={() => void windowAction("minimize")}
          >
            <Minus aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="titlebar-control"
            aria-label={maximized ? "还原窗口" : "最大化"}
            title={maximized ? "还原窗口" : "最大化"}
            disabled={!native}
            onClick={() => void windowAction("toggleMaximize")}
          >
            {maximized ? (
              <Copy aria-hidden="true" />
            ) : (
              <Square aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="titlebar-control titlebar-close"
            aria-label="关闭窗口"
            title="关闭窗口"
            disabled={!native}
            onClick={() => void windowAction("close")}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="border-b border-border bg-destructive/10 px-4 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
    </>
  );
}
