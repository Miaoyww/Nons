import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// One spacing surface for music pages; tune --music-page-* in globals.css.
export function MusicPage({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("music-library music-page", className)} {...props} />;
}
