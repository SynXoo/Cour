import type { Metadata } from "next";
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
    <PageShell width="reading">
      <PartyClient partyId={id} />
    </PageShell>
  );
}
