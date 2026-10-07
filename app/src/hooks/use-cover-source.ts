import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { coverSource, nativeCall } from "@/lib/player";
import { useLocalOptions } from "./use-local-options";

export function useCoverSource(cover?: string, enabled = true) {
  const { showCovers } = useLocalOptions();
  const remote = !!cover && /^https?:\/\//.test(cover);
  const visible = enabled && !!cover && (remote || showCovers);
  const [loaded, setLoaded] = useState<{ cover: string; source: string }>();
  useEffect(() => {
    if (!visible || !remote || !isTauri()) return;
    let disposed = false;
    const sized = new URL(cover!); sized.searchParams.set("param", "512y512");
    void nativeCall<string>("runtime_cover", { url: sized.toString() }).then((source) => { if (!disposed) setLoaded({ cover: cover!, source }); })
      .catch(() => { if (!disposed) { const source = coverSource(cover!); if (source) setLoaded({ cover: cover!, source }); } });
    return () => { disposed = true; };
  }, [cover, visible, remote]);
  if (!visible) return undefined;
  return remote && isTauri() ? loaded?.cover === cover ? loaded.source : undefined : coverSource(cover!);
}
