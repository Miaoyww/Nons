import { useEffect, useRef } from "react";
import { ActionButton } from "./action-button";

export function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

export function InfiniteLoad({ more, busy, error, onLoad }: { more: boolean; busy: boolean; error?: string; onLoad: () => void }) {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = marker.current;
    if (!element || !more || busy || error) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) onLoad();
    }, { root: scrollParent(element), rootMargin: "0px 0px 120px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [more, busy, error, onLoad]);
  return <div ref={marker} className="flex min-h-12 items-center justify-center gap-3 py-3 text-sm text-muted-foreground" aria-live="polite">
    {error ? <><p role="alert">{error}</p><ActionButton size="sm" variant="ghost" onClick={onLoad}>重试</ActionButton></>
      : busy ? <span role="status">正在加载…</span> : more ? <span className="sr-only">滚动到底部自动加载更多</span> : null}
  </div>;
}
