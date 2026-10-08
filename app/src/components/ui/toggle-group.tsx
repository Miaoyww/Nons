import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { cn } from "cn";

export function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return <ToggleGroupPrimitive data-slot="toggle-group" className={cn("inline-flex items-center gap-1 rounded-lg bg-muted/50 p-1", className)} {...props} />;
}

export function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  return <TogglePrimitive data-slot="toggle-group-item" className={cn("inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground data-[pressed]:bg-secondary data-[pressed]:text-secondary-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50", className)} {...props} />;
}
