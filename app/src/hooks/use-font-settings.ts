import { useSyncExternalStore } from "react";
import { getFontSettings, setFont, subscribeFontSettings } from "@/lib/font-settings";

export function useFontSettings() {
  const fonts = useSyncExternalStore(subscribeFontSettings, getFontSettings);
  return { fonts, setFont };
}
