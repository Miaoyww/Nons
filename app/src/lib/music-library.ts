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
export const getMusicLibrary = () => nativeCall<LibrarySummary>("music_library");
export const getLibraryCollections = (kind: LibraryTab, offset: number, filter: PlaylistFilter) =>
  nativeCall<CollectionPage>("library_collections", { kind, offset, filter });
export const getLibraryTracks = (collection: MusicCollection, offset: number) =>
  nativeCall<CollectionTracks>("library_tracks", { kind: collection.kind, id: collection.id, offset });
export const getLibraryHistory = (week: boolean, offset: number) =>
  nativeCall<CollectionTracks>("library_history", { week, offset });
export const playLibraryCollection = (collection: MusicCollection, key?: string) =>
  nativeCall<boolean>("play_library_collection", { kind: collection.kind, id: collection.id, key: key ?? null });
