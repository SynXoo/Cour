"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";

// AniList's standard genre vocabulary.
const GENRES = [
  "Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror",
  "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance",
  "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller",
];

export function SettingsClient() {
  const { status, user } = useSession();

  if (status === "loading") {
    return <Skeleton className="mt-8 h-64 rounded-lg" />;
  }
  if (status === "anon" || !user) {
    return (
      <section className="flex flex-col items-center gap-4 py-24 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  }

  return <SettingsForm key={user.id} />;
}

function SettingsForm() {
  const { user, reload } = useSession();
  const [bio, setBio] = useState(user?.bio ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatar_url ?? "");
  const [genres, setGenres] = useState<string[]>(user?.favorite_genres ?? []);
  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);

  function toggleGenre(g: string) {
    setGenres((prev) =>
      prev.includes(g) ? prev.filter((x) => x !== g) : prev.length < 10 ? [...prev, g] : prev,
    );
  }

  async function save() {
    setSaving(true);
    try {
      const res = await browserApi.PATCH("/me/profile", {
        body: {
          bio,
          avatar_url: avatarUrl.trim() === "" ? "" : avatarUrl.trim(),
          favorite_genres: genres,
        },
      });
      if (res.error) {
        const details = res.error.error.details as Record<string, string> | undefined;
        toast.error(details ? Object.values(details).join("; ") : res.error.error.message);
        return;
      }
      await reload();
      toast.success("Profile saved");
    } finally {
      setSaving(false);
    }
  }

  async function resendVerification() {
    setResending(true);
    try {
      const res = await browserApi.POST("/auth/resend-verification", {});
      if (res.error) {
        toast.error(res.error.error.message);
        return;
      }
      toast.success("Verification email sent — check your inbox");
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 py-4">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      {user && !user.email_verified && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <span>Your email isn&apos;t verified yet.</span>
          <Button size="sm" variant="outline" onClick={resendVerification} disabled={resending}>
            {resending ? "Sending…" : "Resend email"}
          </Button>
        </div>
      )}

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="bio">Bio</FieldLabel>
          <Textarea
            id="bio"
            rows={4}
            maxLength={500}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Seasonal watcher, sakuga enjoyer…"
          />
          <FieldDescription>{bio.length}/500</FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="avatar">Avatar URL</FieldLabel>
          <Input
            id="avatar"
            type="url"
            placeholder="https://…"
            value={avatarUrl}
            onChange={(e) => setAvatarUrl(e.target.value)}
          />
          <FieldDescription>Leave empty to clear.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Favorite genres</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {GENRES.map((g) => {
              const active = genres.includes(g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGenre(g)}
                  aria-pressed={active}
                  className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Badge variant={active ? "default" : "outline"}>{g}</Badge>
                </button>
              );
            })}
          </div>
          <FieldDescription>Up to 10 — shown on your profile and used for recommendations.</FieldDescription>
        </Field>

        <Button onClick={save} disabled={saving} className="self-start">
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </FieldGroup>
    </div>
  );
}
