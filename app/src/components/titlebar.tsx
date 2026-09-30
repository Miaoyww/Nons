import { useEffect, useState, type MouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { Copy, Minus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsDialog } from "@/components/settings/settings-dialog";

export function Titlebar() {
  const native = isTauri();
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
        className="titlebar flex h-12 shrink-0 select-none items-center border-b border-border/70 bg-background"
        data-focused={focused}
      >
        <div
          className="h-full min-w-0 flex-1"
          onMouseDown={drag}
        />

        <div className="flex h-full shrink-0 items-center gap-1 pr-1.5">
          <SettingsDialog />

          <span className="mx-1.5 h-4 w-px bg-border" aria-hidden="true" />
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
