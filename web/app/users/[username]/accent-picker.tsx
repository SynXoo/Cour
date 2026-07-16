"use client";

import { CheckIcon, PaletteIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { browserApi, type AnimeSummary } from "@/lib/api/client";
import { accentSwatches } from "@/lib/profile";
import { cn } from "@/lib/utils";

/**
 * The page accent, picked from the art the owner already told us they love.
 * Cover colors are the primary row — every accent then belongs to a show on
 * their shelf — and a short house palette covers the case where the favorites
 * are all the same muted teal. Everything lands through `color-mix` in
 * globals.css, so no pick can make the page unreadable in either theme.
 *
 * Hovering a swatch repaints the live page, not a preview chip: the accent
 * touches the avatar ring, every heading, and every bar, and there is no
 * honest way to show that at 24px.
 */
export function AccentPicker({
  favorites,
  current,
  onPreview,
  onPicked,
}: {
  favorites: AnimeSummary[];
  current: string | null;
  /** null = drop the preview and fall back to whatever the profile derives. */
  onPreview: (hex: string | null) => void;
  onPicked: (hex: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const fromFavorites = accentSwatches(favorites);

  const save = useMutation({
    mutationFn: async (hex: string) => {
      const res = await browserApi.PATCH("/me/profile", { body: { accent_color: hex } });
      if (res.error) throw new Error(res.error.error.message);
      return hex;
    },
    onSuccess: (hex) => {
      onPicked(hex === "" ? null : hex);
      toast.success(hex === "" ? "Accent reset" : "Accent updated");
      setOpen(false);
    },
    onError: (err) => {
      onPreview(null);
      toast.error(err.message || "Something went wrong");
    },
  });

  // Leaving the popover at all must undo any hover preview; the pointer can
  // exit through the trigger, the edge, or the Escape key.
  const dropPreview = () => {
    if (!save.isPending) onPreview(null);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) dropPreview();
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-11 gap-1.5 md:h-8">
          <PaletteIcon aria-hidden />
          Accent
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3" onMouseLeave={dropPreview}>
        {fromFavorites.length > 0 && (
          <>
            <p className="mb-2 text-sm font-medium">From your favorites</p>
            <Swatches
              colors={fromFavorites}
              current={current}
              disabled={save.isPending}
              onHover={onPreview}
              onPick={(hex) => save.mutate(hex)}
            />
          </>
        )}

        <p className={cn("mb-2 text-sm font-medium", fromFavorites.length > 0 && "mt-4")}>
          House colors
        </p>
        <Swatches
          colors={HOUSE_COLORS}
          current={current}
          disabled={save.isPending}
          onHover={onPreview}
          onPick={(hex) => save.mutate(hex)}
        />

        {fromFavorites.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Favorite a few shows and their cover colors show up here.
          </p>
        )}

        {current && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 h-11 w-full md:h-8"
            disabled={save.isPending}
            onClick={() => save.mutate("")}
          >
            Reset to my banner&apos;s color
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Swatches({
  colors,
  current,
  disabled,
  onHover,
  onPick,
}: {
  colors: string[];
  current: string | null;
  disabled: boolean;
  onHover: (hex: string | null) => void;
  onPick: (hex: string) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {colors.map((hex) => {
        const active = current?.toLowerCase() === hex;
        return (
          <li key={hex}>
            <button
              type="button"
              disabled={disabled}
              aria-pressed={active}
              aria-label={`Accent ${hex}`}
              style={{ backgroundColor: hex }}
              onMouseEnter={() => onHover(hex)}
              // Keyboard users preview as they arrow through, but Radix moves
              // focus into the popover on open — without the :focus-visible
              // gate, merely clicking "Accent" would repaint the whole page in
              // the first house color before anyone chose anything.
              onFocus={(e) => {
                if (e.currentTarget.matches(":focus-visible")) onHover(hex);
              }}
              onClick={() => onPick(hex)}
              className="flex size-8 items-center justify-center rounded-full border border-border/60 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {active && <CheckIcon weight="bold" className="size-4 text-white drop-shadow" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// A spread across the wheel rather than a gradient: whatever the favorites
// offer, there is always something here that contrasts with it.
const HOUSE_COLORS = [
  "#8b5cf6",
  "#e11d48",
  "#f59e0b",
  "#10b981",
  "#0ea5e9",
  "#ec4899",
  "#64748b",
];
