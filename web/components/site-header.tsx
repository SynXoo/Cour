import Link from "next/link";

const nav = [
  { href: "/seasonal", label: "Seasonal" },
  { href: "/schedule", label: "Schedule" },
  { href: "/trending", label: "Trending" },
  { href: "/hidden-gems", label: "Hidden Gems" },
  { href: "/search", label: "Search" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-baseline gap-1 text-lg font-bold tracking-tight">
          <span className="text-primary">Cour</span>
          <span className="hidden text-xs font-normal text-muted-foreground sm:inline">
            this season, together
          </span>
        </Link>
        <nav aria-label="Primary" className="flex flex-1 items-center gap-1 overflow-x-auto">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {/* Auth controls land here in the auth slice */}
      </div>
    </header>
  );
}
