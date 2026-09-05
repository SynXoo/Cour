"use client";

import { UsersThreeIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSession } from "@/lib/auth/session";
import { useFeatures } from "@/lib/hooks/use-features";
import {
  useCreateParty,
  useOpenParties,
  type PartyVisibility,
  type WatchPartySummary,
} from "@/lib/hooks/use-parties";

const VISIBILITY: { value: PartyVisibility; label: string; hint: string }[] = [
  { value: "followers", label: "Followers", hint: "People who follow you, and your friends" },
  { value: "public", label: "Public", hint: "Anyone on Cour can find and join it" },
  { value: "invite", label: "Friends only", hint: "Just your friends" },
];

/**
 * The episode page's entry point (M4.4): the rooms already watching this
 * episode together, and a "Start a party" control. Renders nothing while
 * the feature is off. Anonymous viewers see the open rooms and a sign-in
 * nudge instead of the launcher.
 */
export function PartyLauncher({ animeId, episode }: { animeId: number; episode: number }) {
  const { status } = useSession();
  const features = useFeatures();
  const open = useOpenParties({ animeId, episode });
  const create = useCreateParty();
  const router = useRouter();
  const [visibility, setVisibility] = useState<PartyVisibility>("followers");

  if (!features.data?.watch_parties) return null;
  const rooms = open.data ?? [];

  const start = async () => {
    try {
      const party = await create.mutateAsync({ animeId, episode, visibility });
      router.push(`/parties/${party.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start the party");
    }
  };

  return (
    <section
      aria-label="Watch party"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card px-4 py-3"
      data-testid="party-launcher"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <UsersThreeIcon size={16} weight="fill" className="text-primary" aria-hidden />
            Watch it together
          </h2>
          <p className="text-xs text-muted-foreground">
            {rooms.length > 0
              ? `${rooms.length} ${rooms.length === 1 ? "room is" : "rooms are"} watching this episode right now.`
              : "A shared clock, presence and live chat — everyone brings their own stream."}
          </p>
        </div>

        {status === "authed" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
            className="flex items-center gap-2"
          >
            <Select value={visibility} onValueChange={(v) => setVisibility(v as PartyVisibility)}>
              <SelectTrigger aria-label="Who can join" className="h-11 w-36 md:h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIBILITY.map((v) => (
                  <SelectItem key={v.value} value={v.value}>
                    {v.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={create.isPending} className="min-h-11 md:min-h-9">
              {create.isPending ? "Starting…" : "Start a party"}
            </Button>
          </form>
        ) : status === "anon" ? (
          <Button asChild variant="outline" className="min-h-11 md:min-h-9">
            <Link href="/login">Sign in to start one</Link>
          </Button>
        ) : null}
      </div>

      {status === "authed" && (
        <p className="text-[11px] text-muted-foreground">
          {VISIBILITY.find((v) => v.value === visibility)?.hint}. Starting a new party ends
          any you&rsquo;re already hosting.
        </p>
      )}

      {rooms.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Open rooms for this episode">
          {rooms.map((p) => (
            <li key={p.id}>
              <RoomRow party={p} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RoomRow({ party }: { party: WatchPartySummary }) {
  return (
    <Link
      href={`/parties/${party.id}`}
      className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 md:min-h-9"
    >
      <span className="min-w-0 truncate">
        <span className="font-medium">@{party.host.username}</span>
        <span className="text-muted-foreground">&rsquo;s room</span>
        {party.visibility !== "public" && (
          <span className="ml-1.5 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground uppercase">
            {party.visibility}
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-xs text-muted-foreground">
        {party.watching} watching · Join →
      </span>
    </Link>
  );
}
