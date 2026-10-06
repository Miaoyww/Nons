import { Music2 } from "lucide-react";
import { useState } from "react";
import { coverSource } from "@/lib/player";

export function Cover({ cover, className = "" }: { cover?: string; className?: string }) {
  const [failed, setFailed] = useState<string>();
  const source = cover ? coverSource(cover) : undefined;
  return <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ${className}`}>
    {source && failed !== source ? <img src={source} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(source)} /> : <Music2 className="size-5 text-muted-foreground" aria-hidden="true" />}
  </div>;
}
