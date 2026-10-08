import { LRUCache } from "lru-cache";

export const RUNTIME_TTL = 10 * 60 * 1000;
interface Entry { value: unknown }
type Loader = { load: () => Promise<unknown> };

// LRUCache owns capacity, TTL and concurrent-fetch coalescing. Wrapping values
// allows valid null responses without treating them as a cache miss.
export class RuntimeCache {
  private cache: LRUCache<string, Entry, Loader>;
  private pending = new Map<string, number>();
  constructor(maxBytes = 48 * 1024 * 1024, ttl = RUNTIME_TTL) {
    this.cache = new LRUCache<string, Entry, Loader>({
      max: 512, maxSize: maxBytes, ttl,
      sizeCalculation: (entry, key) => Math.max(1, (JSON.stringify(entry.value)?.length ?? 0) * 2 + key.length * 2),
      fetchMethod: async (_key, _stale, { context }) => ({ value: await context.load() }),
    });
  }
  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    this.pending.set(key, (this.pending.get(key) ?? 0) + 1);
    try {
      const result = await this.cache.fetch(key, { context: { load } });
      if (!result) throw new Error("缓存请求已失效，请重试。");
      return result.value as T;
    } finally {
      const remaining = (this.pending.get(key) ?? 1) - 1;
      if (remaining) this.pending.set(key, remaining); else this.pending.delete(key);
    }
  }
  peek<T>(key: string): T | undefined { return this.cache.peek(key, { allowStale: true })?.value as T | undefined; }
  invalidate(prefixes?: readonly string[]) {
    if (!prefixes) { this.cache.clear(); return; }
    for (const key of new Set([...this.cache.keys(), ...this.pending.keys()])) if (prefixes.some((prefix) => key.startsWith(`${prefix}:`))) this.cache.delete(key);
  }
  delete(key: string) { this.cache.delete(key); }
}

export const requestCache = new RuntimeCache();
export const coverCache = new RuntimeCache(32 * 1024 * 1024);
export const cachedCommands = new Set(["discovery_hitokoto", "music_entity_detail", "artist_albums", "artist_tracks", "discovery_radar", "discovery_playlists", "discovery_categories", "discovery_tracks", "system_fonts", "search_music", "music_library", "library_collections", "library_tracks", "library_history", "liked_song_ids", "local_music", "track_lyrics", "song_information"]);
export function requestKey(command: string, args?: Record<string, unknown>) {
  return `${command}:${JSON.stringify(Object.fromEntries(Object.entries(args ?? {}).filter(([key]) => key !== "refresh").sort(([a], [b]) => a.localeCompare(b))))}`;
}
export function invalidateNativeCache(commands?: readonly string[]) { requestCache.invalidate(commands); }
