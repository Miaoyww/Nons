import { nativeCall, type Lyrics, type Track } from "./player";
import type { LyricSources } from "@/hooks/use-lyric-sources";

// The native service selects sources; semantic parsing failures continue from
// the next source without retrying a source already rejected by the renderer.
export async function loadLyrics<T>(track: Track, refresh: boolean, sources: LyricSources,
  parse: (value: Lyrics | null) => T, isCurrent: () => boolean = () => true) {
  let skipAmll = !sources.amll, skipQq = !sources.qq, skipLocal = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    const lyrics = await nativeCall<Lyrics | null>("track_lyrics", { key: track.key, refresh: attempt === 0 && refresh, skipAmll, skipQq, skipLocal });
    if (!isCurrent()) return null;
    try { return { lyrics, parsed: parse(lyrics) }; }
    catch (cause) {
      if (lyrics?.source === "local") skipLocal = true;
      else if (lyrics?.source === "amll") skipAmll = true;
      else if (lyrics?.source === "qq") skipQq = true;
      else throw cause;
    }
  }
  return null;
}
