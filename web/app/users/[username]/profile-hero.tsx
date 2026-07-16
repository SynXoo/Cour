"use client";

import Image from "next/image";
import { FollowButton } from "@/components/social/follow-button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { fallbackWallCovers, type ProfileBanner, type UserProfile } from "@/lib/profile";
import { AccentPicker } from "./accent-picker";
import { BannerPicker } from "./banner-picker";
import { BioEditor } from "./bio-editor";

/**
 * The profile's front door: full-bleed banner art (the owner's pick) melting
 * into the page via mask, a static poster wall from their shelves when no
 * banner is picked, and the ambient wash when the shelves are empty too —
 * a fresh profile still looks dressed.
 */
export function ProfileHero({
  profile,
  isOwner,
  banner,
  bio,
  accent,
  onBannerChange,
  onBioChange,
  onAccentPreview,
  onAccentChange,
}: {
  profile: UserProfile;
  isOwner: boolean;
  banner: ProfileBanner | null;
  bio: string;
  accent: string | null;
  onBannerChange: (banner: ProfileBanner | null) => void;
  onBioChange: (bio: string) => void;
  onAccentPreview: (hex: string | null) => void;
  onAccentChange: (hex: string | null) => void;
}) {
  const wall = fallbackWallCovers(profile.favorites, profile.currently_watching);

  return (
    <header className="-mt-6">
      {/* Art band — decorative throughout; the identity block below carries
          the accessible content. */}
      <div className="relative -mx-4 h-44 overflow-hidden sm:h-56 lg:h-72" aria-hidden>
        {banner?.banner_image ? (
          <Image
            src={banner.banner_image}
            alt=""
            fill
            priority
            sizes="100vw"
            className="profile-banner-mask object-cover"
          />
        ) : wall.length >= 4 ? (
          <PosterWallStrip covers={wall} />
        ) : (
          <div className="profile-ambient absolute inset-0" />
        )}
        <div className="tint-glow pointer-events-none absolute inset-0" />
      </div>

      <div className="relative flex flex-col gap-4">
        <div className="-mt-14 flex flex-wrap items-end gap-x-4 gap-y-3 sm:-mt-16">
          <Avatar className="tint-ring h-24 w-24 border border-border/60 bg-background text-2xl shadow-lg ring-4 sm:h-28 sm:w-28">
            {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
            <AvatarFallback>{profile.username.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1 pb-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              @{profile.username}
              {profile.role !== "user" && <Badge variant="secondary">{profile.role}</Badge>}
            </h1>
            <p className="font-mono text-xs text-muted-foreground">
              Member since{" "}
              {new Date(profile.created_at).toLocaleDateString(undefined, {
                month: "long",
                year: "numeric",
              })}
            </p>
          </div>
          {isOwner && (
            <div className="flex flex-wrap gap-2 pb-1">
              <AccentPicker
                favorites={profile.favorites}
                current={accent}
                onPreview={onAccentPreview}
                onPicked={onAccentChange}
              />
              <BannerPicker
                favorites={profile.favorites}
                current={banner}
                onPicked={onBannerChange}
              />
            </div>
          )}
        </div>

        <BioEditor bio={bio} isOwner={isOwner} onSaved={onBioChange} />

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <FollowButton username={profile.username} />
          {profile.favorite_genres.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Favorite genres">
              {profile.favorite_genres.map((g) => (
                <li key={g}>
                  <Badge variant="outline">{g}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </header>
  );
}

/** One level row of covers standing in for banner art: a filmstrip that fills
 * the band edge to edge, centered so the overflow is even on both sides. Each
 * cover crops to the band's height rather than keeping its 2:3 box — a banner
 * is a horizon, and a tilted or letterboxed row reads as a mistake. Static —
 * the landing's marquee would be noise here — and purely decorative. */
function PosterWallStrip({ covers }: { covers: { id: number; cover_image: string }[] }) {
  return (
    <ul className="profile-banner-mask absolute inset-0 flex items-stretch justify-center gap-1.5 opacity-80">
      {covers.map((c, i) => (
        <li key={c.id} className="relative w-28 shrink-0 overflow-hidden sm:w-32 lg:w-40">
          {/* The wall is the LCP when it stands in for the banner. */}
          <Image src={c.cover_image} alt="" fill priority={i < 6} sizes="160px" className="object-cover" />
        </li>
      ))}
    </ul>
  );
}
