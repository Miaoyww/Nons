import type { Track } from "@/lib/player";

export function trackDisplayTitle(track: Track) {
  return track.title + (track.aliases?.length ? ` (${track.aliases.join(" / ")})` : "");
}

export function TrackTitle({ track }: { track: Track }) {
  return <>{track.title}{!!track.aliases?.length && <span className="font-normal text-muted-foreground"> ({track.aliases.join(" / ")})</span>}</>;
}
