import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { serverApi } from "@/lib/api/client";
import { hostableEpisodes, hostableWindow } from "@/lib/parties-hub";
import { PartiesHub } from "./parties-hub";

export const metadata: Metadata = {
  title: "Watch parties",
  description:
    "Watch an episode with other people, in sync — a shared clock, live chat and timestamped reactions. Cour never hosts or links to streams; everyone brings their own.",
};

// The window slides with the clock, so a long cache would eventually serve
// "already out" episodes as "soon". A minute is well inside the tolerance.
const shortFetch = (input: Request) => fetch(input, { next: { revalidate: 60 } });

/**
 * The watch-party hub. M4 shipped the whole feature — gateway, shared clock,
 * chat — behind two rails that render nothing when no room happens to be
 * open, so it had no destination of its own and no place in the nav. This
 * is that destination: what is open now, what a party actually is, and the
 * episodes you could open one on tonight.
 */
export default async function PartiesPage() {
  const now = new Date();
  const res = await serverApi()
    .GET("/schedule", { params: { query: hostableWindow(now) }, fetch: shortFetch })
    .catch(() => null);

  const episodes = hostableEpisodes(res?.data?.data ?? [], now);

  return (
    <PageShell width="browse" className="flex flex-col gap-6">
      <header className="max-w-2xl space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <UsersThreeIcon size={26} weight="fill" className="text-primary" aria-hidden />
          Watch parties
        </h1>
        <p className="text-sm text-muted-foreground">
          The season, at the same time, with other people. A room holds a shared clock, live
          chat and reactions pinned to the second &mdash; everyone presses play together on
          their own stream.
        </p>
      </header>

      <PartiesHub episodes={episodes} />
    </PageShell>
  );
}
