import { Music2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCoverSource } from "@/hooks/use-cover-source";

export function Cover({ cover, className = "" }: { cover?: string; className?: string }) {
  const [failed, setFailed] = useState<string>();
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!host.current) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setVisible(true); observer.disconnect(); } }, { rootMargin: "200px" });
    observer.observe(host.current); return () => observer.disconnect();
  }, []);
  const source = useCoverSource(cover, visible);
  return <div ref={host} className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted ${className}`}>
    {source && failed !== source ? <img src={source} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(source)} /> : <Music2 className="size-5 text-muted-foreground" aria-hidden="true" />}
  </div>;
}
