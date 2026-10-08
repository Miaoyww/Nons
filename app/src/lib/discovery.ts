import { nativeCall } from "./player";
import type { CollectionPage } from "./music-library";

interface PlaylistQuery {
  section: "recommended" | "square";
  category: string;
  order: string;
  refresh: boolean;
}

// Keep cached pages intact; deduplicate only this query's displayed collections.
export function createDiscoveryPlaylistLoader(query: PlaylistQuery) {
  const seen = new Set<number>();
  return async (offset: number): Promise<CollectionPage> => {
    const page = await nativeCall<CollectionPage>("discovery_playlists", { ...query, offset });
    if (offset === 0) seen.clear();
    return {
      ...page,
      items: page.items.filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      }),
    };
  };
}
