import { useEffect, useState, type MouseEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  Copy,
  Minus,
  Monitor,
  Moon,
  Settings,
  Square,
  Sun,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "@/components/animate-ui/components/base/dialog";
import { useTheme } from "@/hooks/use-theme";

const themes = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
] as const;

export function Titlebar() {
  const native = isTauri();
  const reducedMotion = useReducedMotion();
  const [theme, setTheme] = useTheme();
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
          <Dialog>
            <DialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="titlebar-settings rounded-lg"
                  aria-label="设置"
                  title="设置"
                />
              }
            >
              <motion.span
                className="flex items-center justify-center"
                whileHover={reducedMotion ? undefined : { rotate: 45 }}
                transition={{ duration: 0.2 }}
              >
                <Settings aria-hidden="true" />
              </motion.span>
            </DialogTrigger>
            <DialogPopup
              className="max-w-[calc(100%-2rem)] rounded-2xl sm:max-w-sm"
              showCloseButton={false}
              initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: reducedMotion ? 1 : 0.98 }}
              transition={{ duration: reducedMotion ? 0 : 0.18 }}
            >
              <DialogHeader>
                <DialogTitle>设置</DialogTitle>
                <DialogDescription>
                  让 Nons 更符合你的使用习惯。
                </DialogDescription>
              </DialogHeader>
              <fieldset className="my-2 flex flex-col gap-3">
                <legend className="mb-3 text-sm font-medium">外观</legend>
                <div className="grid grid-cols-3 gap-2">
                  {themes.map(({ value, label, icon: Icon }) => (
                    <label key={value} className="relative cursor-pointer">
                      <input
                        type="radio"
                        name="theme"
                        value={value}
                        checked={theme === value}
                        onChange={() => setTheme(value)}
                        className="peer sr-only"
                      />
                      <span className="flex flex-col items-center gap-2 rounded-xl border border-border px-2 py-4 text-muted-foreground transition-colors hover:bg-muted peer-checked:border-primary peer-checked:bg-accent peer-checked:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                        <Icon className="size-5" aria-hidden="true" />
                        <span className="text-xs font-medium">{label}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <DialogFooter>
                <DialogClose render={<Button size="sm" />}>完成</DialogClose>
              </DialogFooter>
            </DialogPopup>
          </Dialog>

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
