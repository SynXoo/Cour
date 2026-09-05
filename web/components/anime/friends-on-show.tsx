"use client";

import { PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import { useAnimeFriends, useFriendsOverview } from "@/lib/hooks/use-social";
import { friendStandingLabel } from "@/lib/social";

/**
 * "Friends on this show" (§M3.9): who you know is watching it and where
 * they are, the recommendations you received for it, and the button to
 * send it on. A client island — friendships are personal, so the server
 * page never sees them. Renders nothing for visitors and for members with
 * no friends yet (the friends hub is the place to fix that, not here).
 */
export function FriendsOnShow({ animeId, episodesCount }: { animeId: number; episodesCount: number | null }) {
  const { status } = useSession();
  const { data } = useAnimeFriends(animeId);
  const overview = useFriendsOverview();

  if (status !== "authed" || !data) return null;
  const friends = overview.data?.friends ?? [];
  if (data.data.length === 0 && data.recommendations.length === 0 && friends.length === 0) return null;

  return (
    <section aria-labelledby="friends-on-show" className="space-y-3">
      {data.recommendations.length > 0 && (
        <ul className="space-y-2">
          {data.recommendations.map((rec) => (
            <li
              key={rec.from.username}
              className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5 text-sm"
            >
              <Avatar className="h-7 w-7 shrink-0 text-[10px]">
                {rec.from.avatar_url && <AvatarImage src={rec.from.avatar_url} alt="" />}
                <AvatarFallback>{rec.from.username.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <p className="min-w-0">
                <Link href={`/users/${rec.from.username}`} className="font-medium hover:text-primary">
                  @{rec.from.username}
                </Link>{" "}
                <span className="text-muted-foreground">thinks you&apos;d like this</span>
                {rec.note && <span className="block text-foreground/90">“{rec.note}”</span>}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="friends-on-show" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Friends on this show
          {data.data.length > 0 && (
            <span className="ml-1.5 font-mono text-xs font-normal normal-case">{data.data.length}</span>
          )}
        </h2>
        {friends.length > 0 && (
          <RecommendDialog animeId={animeId} friends={friends.map((f) => f.username)} />
        )}
      </div>

      {data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">None of your friends track this one yet — send it on.</p>
      ) : (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {data.data.map((f) => (
            <li key={f.user.username} className="shrink-0">
              <Link
                href={`/users/${f.user.username}`}
                className="flex items-center gap-2 rounded-full border border-border/60 bg-card py-1 pl-1 pr-3 text-xs transition-colors hover:border-primary/50"
              >
                <Avatar className="h-6 w-6 text-[10px]">
                  {f.user.avatar_url && <AvatarImage src={f.user.avatar_url} alt="" />}
                  <AvatarFallback>{f.user.username.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <span className="font-medium">@{f.user.username}</span>
                <span className="font-mono text-muted-foreground">{friendStandingLabel(f, episodesCount)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RecommendDialog({ animeId, friends }: { animeId: number; friends: string[] }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(friends[0] ?? "");
  const [note, setNote] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      const res = await browserApi.POST("/anime/{id}/recommend", {
        params: { path: { id: animeId } },
        body: { to, note: note.trim() },
      });
      if (res.error) throw new Error(res.error.error.message);
    },
    onSuccess: () => {
      toast.success(`Sent to @${to}`);
      setNote("");
      setOpen(false);
    },
    onError: (err) => toast.error(err.message || "Could not send — try again."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <PaperPlaneTiltIcon size={14} aria-hidden />
          Recommend to a friend
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Recommend to a friend</DialogTitle>
          <DialogDescription>
            They get a notification with your note, and it shows on the show&apos;s page for them.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="rec-to">Friend</FieldLabel>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger id="rec-to">
                <SelectValue placeholder="Pick a friend" />
              </SelectTrigger>
              <SelectContent>
                {friends.map((u) => (
                  <SelectItem key={u} value={u}>
                    @{u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="rec-note">Why they&apos;d like it</FieldLabel>
            <Textarea
              id="rec-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — one line beats a summary."
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" onClick={() => send.mutate()} disabled={!to || send.isPending}>
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
