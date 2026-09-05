import Link from "next/link";
import { UserMenu } from "@/components/auth/user-menu";
import { InboxBadge } from "@/components/messages/inbox-badge";
import { NotificationBell } from "@/components/notifications/bell";
import { PartiesNavLink } from "@/components/parties/parties-nav-link";

/**
 * The links after Parties, which is rendered on its own because it carries a
 * live count. Parties taking the second slot cost Hidden Gems the header
 * entry it used to hold — six links is already where the row starts
 * scrolling below `lg`. Gems keeps its page, its tile in the home page's
 * "More to explore", and its row in the mobile Menu: a discovery detour,
 * where a party is a destination.
 */
const nav = [
  { href: "/threads", label: "Threads" },
  { href: "/schedule", label: "Schedule" },
  { href: "/trending", label: "Trending" },
  { href: "/search", label: "Search" },
];

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {label}
    </Link>
  );
}

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
          <NavLink href="/seasonal" label="Seasonal" />
          <PartiesNavLink />
          {nav.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:gap-3">
          <InboxBadge />
          <NotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
