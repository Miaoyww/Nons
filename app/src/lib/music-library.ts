import { requestCache, requestKey, invalidateNativeCache } from "./runtime-cache";
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
let accountId: number | undefined;
export function invalidateMusicLibrary() {
  invalidateNativeCache(["music_library", "library_tracks", "library_collections"]);
}
export function resetAccountCache() { accountId = undefined; invalidateNativeCache(); }
function selectAccount(userId: number) {
  if (accountId !== undefined && accountId !== userId) resetAccountCache();
  accountId = userId;
}
export function peekMusicLibrary(userId: number) {
  selectAccount(userId);
  return requestCache.peek<LibrarySummary>(requestKey("music_library"));
}
export function getMusicLibrary(userId: number): Promise<LibrarySummary> {
  selectAccount(userId);
  return nativeCall<LibrarySummary>("music_library");
}
export const getLibraryCollections = (kind: LibraryTab, offset: number, filter: PlaylistFilter) =>
  nativeCall<CollectionPage>("library_collections", { kind, offset, filter });
export function getLibraryTracks(collection: MusicCollection, offset: number, userId: number): Promise<CollectionTracks> {
  selectAccount(userId);
  return nativeCall<CollectionTracks>("library_tracks", { kind: collection.kind, id: collection.id, offset });
}
export const getLibraryHistory = (week: boolean, offset: number) =>
  nativeCall<CollectionTracks>("library_history", { week, offset });
export const playLibraryCollection = (collection: MusicCollection, key?: string) =>
  nativeCall<boolean>("play_library_collection", { kind: collection.kind, id: collection.id, key: key ?? null });
