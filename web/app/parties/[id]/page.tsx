import { CaretLeftIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/page-shell";
import { PartyClient } from "./party-client";

type Params = { id: string };

export const metadata: Metadata = {
  title: "Watch party",
  description:
    "Watch an episode together on Cour — a shared room with live presence. Bring your own legal stream; Cour only syncs people.",
};

/**
 * One watch party (docs/WATCH_PARTIES.md, M4.1). The shell is static; the
 * room is entirely client-side because reading a party needs the viewer's
 * session (visibility) and presence arrives over the socket.
 */
export default async function PartyPage({ params }: { params: Promise<Params> }) {
  const { id: raw } = await params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return (
    <PageShell width="reading" className="space-y-3">
      {/* Every other room state (ended, forbidden, not found) renders inside
          PartyClient, so the way back out belongs to the shell. */}
      <Link
        href="/parties"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-primary md:min-h-0"
      >
        <CaretLeftIcon size={14} aria-hidden />
        All watch parties
      </Link>
      <PartyClient partyId={id} />
    </PageShell>
  );
}
