import { nativeCall, type Track } from "./player";
import type { AccountProfile } from "@/components/player/account";
import type { MusicCollection } from "@/components/player/music-navigation";

export type LibraryTab = "playlist" | "album" | "artist" | "history";
export type PlaylistFilter = "all" | "mine" | "liked";
export interface LibrarySummary {
  profile: AccountProfile;
  likedPlaylist: MusicCollection | null;
  likedTracks: Track[];
  likedError: string | null;
}
export interface CollectionPage { items: MusicCollection[]; more: boolean }
export interface CollectionTracks { description?: string | null; tracks: Track[]; total: number; more: boolean }
const CACHE_TTL = 10 * 60 * 1000;
// One account, one summary and at most ten 100-track pages stay in memory.
let accountId: number | undefined;
let cacheGeneration = 0;
let summaryCache: { value: LibrarySummary; expires: number } | undefined;
let summaryRequest: Promise<LibrarySummary> | undefined;
const trackCache = new Map<number, { value: CollectionTracks; expires: number }>();
const trackRequests = new Map<number, Promise<CollectionTracks>>();

export function invalidateMusicLibrary() {
  cacheGeneration++;
  summaryCache = undefined; summaryRequest = undefined;
  trackCache.clear(); trackRequests.clear();
}
function selectAccount(userId: number) {
  if (accountId !== userId) { invalidateMusicLibrary(); accountId = userId; }
}
export function peekMusicLibrary(userId: number) {
  selectAccount(userId);
  return summaryCache?.value;
}
export function getMusicLibrary(userId: number): Promise<LibrarySummary> {
  selectAccount(userId);
  if (summaryCache && summaryCache.expires > Date.now()) return Promise.resolve(summaryCache.value);
  if (summaryRequest) return summaryRequest;
  const generation = cacheGeneration;
  const request = nativeCall<LibrarySummary>("music_library").then((value) => {
    if (generation === cacheGeneration && !value.likedError) summaryCache = { value, expires: Date.now() + CACHE_TTL };
    return value;
  }).finally(() => { if (summaryRequest === request) summaryRequest = undefined; });
  summaryRequest = request;
  return request;
}
export const getLibraryCollections = (kind: LibraryTab, offset: number, filter: PlaylistFilter) =>
  nativeCall<CollectionPage>("library_collections", { kind, offset, filter });
export function getLibraryTracks(collection: MusicCollection, offset: number, userId: number): Promise<CollectionTracks> {
  selectAccount(userId);
  const load = () => nativeCall<CollectionTracks>("library_tracks", { kind: collection.kind, id: collection.id, offset });
  if (collection.kind !== "playlist" || collection.id !== summaryCache?.value.likedPlaylist?.id) return load();
  const cached = trackCache.get(offset);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached.value);
  const pending = trackRequests.get(offset);
  if (pending) return pending;
  const generation = cacheGeneration;
  const request = load().then((value) => {
    if (generation === cacheGeneration) {
      trackCache.delete(offset);
      if (trackCache.size >= 10) trackCache.delete(trackCache.keys().next().value!);
      trackCache.set(offset, { value, expires: Date.now() + CACHE_TTL });
    }
    return value;
  }).finally(() => { if (trackRequests.get(offset) === request) trackRequests.delete(offset); });
  trackRequests.set(offset, request);
  return request;
}
export const getLibraryHistory = (week: boolean, offset: number) =>
  nativeCall<CollectionTracks>("library_history", { week, offset });
export const playLibraryCollection = (collection: MusicCollection, key?: string) =>
  nativeCall<boolean>("play_library_collection", { kind: collection.kind, id: collection.id, key: key ?? null });
