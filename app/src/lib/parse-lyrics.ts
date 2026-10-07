import { parseLrc, parseQrc, parseTTML, parseYrc } from "@applemusic-like-lyrics/lyric";
import type { LyricLine } from "@applemusic-like-lyrics/core";
import type { Lyrics } from "./player";

export class EmptyLyricsError extends Error {}

export function parseLyricsContent(value: Lyrics): LyricLine[] {
  switch (value.format) {
    case "ttml": return parseTTML(value.content).lines;
    case "yrc": return parseYrc(value.content);
    case "qrc": return parseQrc(value.content);
    case "lrc": return parseLrc(value.content);
  }
}

function auxiliary(text: string) {
  const lines = /^\[\d+,\d+\]/m.test(text) ? parseQrc(text) : parseLrc(text);
  return new Map(lines.map((line) => [line.startTime, line.words.map((word) => word.word).join("")]));
}

export function parseLyrics(value: Lyrics, duration: number): LyricLine[] {
  const result = parseLyricsContent(value).filter((line) => line.words.some((word) => word.word.trim()));
  const translations = value.translation ? auxiliary(value.translation) : undefined;
  const romans = value.romanization ? auxiliary(value.romanization) : undefined;
  if (!result.length) throw new EmptyLyricsError();
  return result.map((line, index) => {
    const end = Number.isFinite(line.endTime) && line.endTime > line.startTime ? line.endTime : result[index + 1]?.startTime ?? Math.max(duration, line.startTime + 5000);
    if (!Number.isFinite(line.startTime) || line.startTime < 0 || end < line.startTime) throw new Error("歌词时间轴无效。");
    if (line.words.some((word) => !Number.isFinite(word.startTime) || word.startTime < 0 || !Number.isFinite(word.endTime) || word.endTime < word.startTime)) throw new Error("歌词逐词时间轴无效。");
    return { ...line, endTime: end, words: line.words.map((word) => ({ ...word, endTime: Number.isFinite(word.endTime) && word.endTime > word.startTime ? word.endTime : end })),
      translatedLyric: translations?.get(line.startTime) ?? line.translatedLyric, romanLyric: romans?.get(line.startTime) ?? line.romanLyric };
  });
}
