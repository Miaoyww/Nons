import { createContext, useContext, useState, type ReactNode } from "react";

export type MusicView = "library" | "discover" | "local" | "search" | "queue" | "collection" | "plugin";
export interface MusicCollection { id: number; kind: "playlist" | "album" | "artist"; name: string; cover: string; subtitle: string; trackCount: number; creatorId?: number; liked?: boolean }
interface Page { view: MusicView; query: string; collection?: MusicCollection }
const NavigationContext = createContext<{
  page: Page; canBack: boolean; canForward: boolean;
  navigate: (view: MusicView, query?: string, collection?: MusicCollection) => void; back: () => void; forward: () => void;
} | null>(null);

export function MusicNavigationProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<{ entries: Page[]; index: number }>({ entries: [{ view: "library", query: "" }], index: 0 });
  function navigate(view: MusicView, query = "", collection?: MusicCollection) {
    setHistory((previous) => {
      const current = previous.entries[previous.index];
      if (current.view === view && current.query === query && current.collection?.id === collection?.id && current.collection?.kind === collection?.kind) return previous;
      // Bound history; navigating after going back discards the forward branch.
      const entries = [...previous.entries.slice(0, previous.index + 1), { view, query, collection }].slice(-100);
      return { entries, index: entries.length - 1 };
    });
  }
  const move = (delta: number) => setHistory((previous) => ({ ...previous, index: Math.max(0, Math.min(previous.entries.length - 1, previous.index + delta)) }));
  return <NavigationContext.Provider value={{ page: history.entries[history.index], canBack: history.index > 0, canForward: history.index < history.entries.length - 1, navigate, back: () => move(-1), forward: () => move(1) }}>{children}</NavigationContext.Provider>;
}

export function useMusicNavigation() {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("MusicNavigationProvider is required");
  return value;
}
