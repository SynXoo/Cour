"use client";

import {
  CalendarBlankIcon,
  CalendarDotsIcon,
  ChatCircleIcon,
  ChatsCircleIcon,
  HouseIcon,
  type Icon,
  ListChecksIcon,
  UsersThreeIcon,
  ListIcon,
  MagicWandIcon,
  MagnifyingGlassIcon,
  RssIcon,
  SparkleIcon,
  TrendUpIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useSession } from "@/lib/auth/session";
import { cn } from "@/lib/utils";

/**
 * Mobile-only bottom tab bar (hidden ≥ md, where the header nav takes over).
 * The four destinations that earn a thumb slot get tabs; everything else the
 * collapsed header no longer shows lives behind the Menu sheet. Height is
 * 4 rem — the root layout's mobile body padding must match so page content
 * and the footer clear the fixed bar.
 */
const tabs: { href: string; label: string; icon: Icon; exact?: boolean }[] = [
  { href: "/", label: "Home", icon: HouseIcon, exact: true },
  { href: "/seasonal", label: "Seasonal", icon: CalendarDotsIcon },
  { href: "/search", label: "Search", icon: MagnifyingGlassIcon },
  { href: "/list", label: "My list", icon: ListChecksIcon },
];

const browseLinks: { href: string; label: string; icon: Icon }[] = [
  { href: "/threads", label: "Threads", icon: ChatsCircleIcon },
  { href: "/schedule", label: "Schedule", icon: CalendarBlankIcon },
  { href: "/trending", label: "Trending", icon: TrendUpIcon },
  { href: "/hidden-gems", label: "Hidden Gems", icon: SparkleIcon },
];

const personalLinks: { href: string; label: string; icon: Icon }[] = [
  { href: "/feed", label: "Feed", icon: RssIcon },
  { href: "/friends", label: "Friends", icon: UsersThreeIcon },
  { href: "/messages", label: "Messages", icon: ChatCircleIcon },
  { href: "/recommendations", label: "For you", icon: MagicWandIcon },
];

const tabClass = (active: boolean) =>
  cn(
    "flex flex-col items-center justify-center gap-1 text-[11px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
    active ? "text-primary" : "text-muted-foreground",
  );

export function BottomNav() {
  const pathname = usePathname() ?? "";
  const { status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  const menuLinks = [...browseLinks, ...(status === "authed" ? personalLinks : [])];
  const menuActive = menuLinks.some((l) => isActive(l.href));

  return (
    <>
      <nav
        aria-label="Primary, mobile"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/80 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur supports-[backdrop-filter]:bg-background/60 md:hidden"
      >
        <div className="grid h-16 grid-cols-5">
          {tabs.map((tab) => {
            const active = isActive(tab.href, tab.exact);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={tabClass(active)}
              >
                <tab.icon size={22} weight={active ? "fill" : "regular"} aria-hidden />
                {tab.label}
              </Link>
            );
          })}
          <button
            type="button"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
            className={tabClass(menuActive || menuOpen)}
          >
            <ListIcon size={22} weight={menuActive || menuOpen ? "fill" : "regular"} aria-hidden />
            Menu
          </button>
        </div>
      </nav>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden"
        >
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription className="sr-only">More places to go.</SheetDescription>
          </SheetHeader>
          <nav aria-label="More destinations" className="flex flex-col px-2 pb-2">
            {menuLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={cn(
                  "flex h-12 items-center gap-3 rounded-md px-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive(link.href) ? "text-primary" : "text-foreground",
                )}
              >
                <link.icon size={20} aria-hidden />
                {link.label}
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
