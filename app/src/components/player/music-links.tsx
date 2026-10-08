import { Fragment, useState, type MouseEvent } from "react";
import { errorText, nativeCall, type MusicCredit, type Track } from "@/lib/player";
import { useMusicNavigation } from "./music-navigation";

export function ArtistLinks({ artists, name = "", separator = "/" }: { artists?: MusicCredit[]; name?: string; separator?: string }) {
  const { navigate } = useMusicNavigation();
  const credits = artists?.length ? artists : name.split(" / ").map((name) => ({ name } as MusicCredit));
  return <span className="music-credits">{credits.map((artist, index) => <Fragment key={`${artist.id ?? artist.name}:${index}`}>
    {index > 0 && <span className="music-credit-separator"> {separator} </span>}
    {artist.id ? <button type="button" className="music-entity-link" onClick={(event: MouseEvent) => {
      event.stopPropagation();
      navigate("artist", "", { id: artist.id!, kind: "artist", name: artist.name, cover: "", subtitle: "", trackCount: 0 });
    }}>{artist.name}</button> : <span>{artist.name}</span>}
  </Fragment>)}</span>;
}

export function AlbumLink({ id, name, cover = "" }: { id?: number | null; name: string; cover?: string }) {
  const { navigate } = useMusicNavigation();
  return id ? <button type="button" className="music-entity-link" onClick={(event) => {
    event.stopPropagation();
    navigate("album", "", { id, kind: "album", name, cover, subtitle: "", trackCount: 0 });
  }}>{name}</button> : <span>{name}</span>;
}

export function TrackArtists({ track }: { track: Track }) {
  const { navigate } = useMusicNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const onlineId = track.source.kind === "netease" ? track.source.id : track.source.neteaseId;
  if (track.artists?.length || !onlineId) return <ArtistLinks artists={track.artists} name={track.artist} />;
  // Older persisted tracks have names only. Resolve their credits on demand, never per row on mount.
  return <span>{track.artist.split(" / ").map((name, index) => <Fragment key={`${name}:${index}`}>
    {index > 0 && <span className="music-credit-separator"> / </span>}
    <button type="button" className="music-entity-link" disabled={busy} title={error ?? name} onClick={(event) => {
      event.stopPropagation(); if (busy) return;
      setBusy(true); setError(undefined);
      void nativeCall<{ artists: MusicCredit[] }>("song_information", { key: track.key }).then((value) => {
        const artist = value.artists.find((artist) => artist.name === name);
        if (!artist?.id) throw new Error("暂无可跳转的歌手信息");
        navigate("artist", "", { id: artist.id, kind: "artist", name: artist.name, cover: "", subtitle: "", trackCount: 0 });
      }).catch((cause) => setError(errorText(cause))).finally(() => setBusy(false));
    }}>{name}</button>
  </Fragment>)}{error && <span role="status" className="sr-only">{error}</span>}</span>;
}

export function TrackAlbum({ track }: { track: Track }) {
  const { navigate } = useMusicNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const onlineId = track.source.kind === "netease" ? track.source.id : track.source.neteaseId;
  if (track.albumId || !onlineId) return <AlbumLink id={track.albumId} name={track.album} cover={track.cover} />;
  return <span><button type="button" className="music-entity-link" disabled={busy} title={error ?? track.album} onClick={(event) => {
    event.stopPropagation(); if (busy) return;
    setBusy(true); setError(undefined);
    void nativeCall<{ albumId?: number | null }>("song_information", { key: track.key }).then((value) => {
      if (!value.albumId) throw new Error("暂无可跳转的专辑信息");
      navigate("album", "", { id: value.albumId, kind: "album", name: track.album, cover: track.cover, subtitle: "", trackCount: 0 });
    }).catch((cause) => setError(errorText(cause))).finally(() => setBusy(false));
  }}>{track.album}</button>{error && <span role="status" className="sr-only">{error}</span>}</span>;
}

export function formatReleaseDate(value?: number | null) {
  return value ? new Date(value).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) : "发行日期未知";
}
