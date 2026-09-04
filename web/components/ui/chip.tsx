"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A toggle chip: the seasonal chart's filter pill, shared. `aria-pressed`
 * carries the state for assistive tech; the visual is default vs outline.
 */
export function Chip({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      aria-pressed={active}
      onClick={onClick}
      className={cn("rounded-full", !active && "text-muted-foreground", className)}
    >
      {children}
    </Button>
  );
}
