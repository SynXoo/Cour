import { cn } from "@/lib/utils";

/**
 * Per-surface page container. Replaces the old one-size `max-w-6xl` shell:
 * poster grids want room, comment threads want a readable measure, forms
 * stay narrow. Keeps the `mx-auto px-4 py-6` the old <main> provided so
 * pages relying on it (e.g. the anime banner's `-mx-4`/`-mt-6` bleed) are
 * unaffected. The header/footer containers track the widest (`browse`).
 */
const WIDTHS = {
  browse: "max-w-[88rem]", // ~1400px — seasonal/trending/search poster grids
  reading: "max-w-3xl", // comment column — threads, reviews, feed
  form: "max-w-xl", // auth/settings-style forms
} as const;

export type ShellWidth = keyof typeof WIDTHS;

export function PageShell({
  width = "browse",
  className,
  children,
}: {
  width?: ShellWidth;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full px-4 py-6", WIDTHS[width], className)}>
      {children}
    </div>
  );
}
