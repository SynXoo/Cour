import Link from "next/link";
import { UserMenu } from "@/components/auth/user-menu";
import { NotificationBell } from "@/components/notifications/bell";

const nav = [
  { href: "/seasonal", label: "Seasonal" },
  { href: "/threads", label: "Threads" },
  { href: "/schedule", label: "Schedule" },
  { href: "/trending", label: "Trending" },
  { href: "/hidden-gems", label: "Hidden Gems" },
  { href: "/search", label: "Search" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 pt-[env(safe-area-inset-top)] backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-[88rem] items-center gap-6 px-4">
        <Link href="/" className="flex items-baseline gap-1 text-lg font-bold tracking-tight">
          {/* The wordmark keeps the mono face — it's the brand, not body text. */}
          <span className="font-mono text-primary">Cour</span>
          {/* lg+: below that the tagline squeezes the nav links into a scroll. */}
          <span className="hidden text-xs font-normal text-muted-foreground lg:inline">
            this season, together
          </span>
        </Link>
        {/* Below md the tab bar + its Menu sheet carry these destinations. */}
        <nav aria-label="Primary" className="hidden flex-1 items-center gap-1 overflow-x-auto md:flex">
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
        <div className="ml-auto flex items-center gap-3 md:gap-6">
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
