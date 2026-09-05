import type { components } from "@/lib/api/schema";

export type RelationState = components["schemas"]["RelationState"];
export type FriendshipStatus = components["schemas"]["FriendshipStatus"];
export type FriendsOverview = components["schemas"]["FriendsOverview"];
export type FriendRef = components["schemas"]["FriendRef"];
export type FriendRequest = components["schemas"]["FriendRequest"];
export type FriendOnAnime = components["schemas"]["FriendOnAnime"];
export type AnimeRecommendation = components["schemas"]["AnimeRecommendation"];
export type FriendsOnAnime = components["schemas"]["FriendsOnAnime"];
export type FriendRecommendation = components["schemas"]["FriendRecommendation"];
export type InboxEntry = components["schemas"]["InboxEntry"];
export type DirectMessage = components["schemas"]["DirectMessage"];
export type UserRef = components["schemas"]["ReviewAuthor"];

/** The relation query key, shared by every button that reads or writes it. */
export const relationKey = (username: string) => ["follow", username] as const;

export type FriendAction = {
  label: string;
  /** PUT (befriend / accept) or DELETE (cancel / decline / unfriend). */
  verb: "befriend" | "unfriend";
  tone: "default" | "secondary";
  /** Hover copy when the label alone would hide what the click does. */
  title?: string;
};

/**
 * The one friend button, four states. `self` and `none`-for-anonymous
 * render nothing (the caller checks auth); the server's two verbs cover
 * every transition so the button never needs a third endpoint.
 */
export function friendAction(status: FriendshipStatus): FriendAction | null {
  switch (status) {
    case "none":
      return { label: "Add friend", verb: "befriend", tone: "default" };
    case "request_received":
      return { label: "Accept request", verb: "befriend", tone: "default" };
    case "request_sent":
      return { label: "Requested", verb: "unfriend", tone: "secondary", title: "Cancel request" };
    case "friends":
      return { label: "Friends ✓", verb: "unfriend", tone: "secondary", title: "Unfriend" };
    default:
      return null;
  }
}

// Mirrors the backend's mention rule (discussions/mentions.go): a word-start
// @ followed by 3–20 username characters, so emails and "@@" never link.
const MENTION_RE = /(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]{3,20})\b/g;

export type BodySegment = { kind: "text"; value: string } | { kind: "mention"; value: string };

/**
 * Splits a comment body into plain runs and @mentions so the renderer can
 * turn mentions into profile links without touching whitespace or the
 * characters around them.
 */
export function splitMentions(body: string): BodySegment[] {
  const out: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(MENTION_RE)) {
    const at = m.index + m[1].length; // the "@"
    if (at > last) out.push({ kind: "text", value: body.slice(last, at) });
    out.push({ kind: "mention", value: m[2] });
    last = at + 1 + m[2].length;
  }
  if (last < body.length) out.push({ kind: "text", value: body.slice(last) });
  return out;
}

/**
 * Friends grouped by the episode they're on, for the marker avatars on the
 * episode list. Only people mid-show count — a completed friend isn't "on"
 * an episode, and progress 0 is nowhere yet.
 */
export function friendMarkers(friends: FriendOnAnime[]): Map<number, FriendOnAnime[]> {
  const byEpisode = new Map<number, FriendOnAnime[]>();
  for (const f of friends) {
    if ((f.status !== "watching" && f.status !== "paused") || f.progress <= 0) continue;
    const list = byEpisode.get(f.progress) ?? [];
    list.push(f);
    byEpisode.set(f.progress, list);
  }
  return byEpisode;
}

/** One line per friend for the "friends on this show" strip. */
export function friendStandingLabel(f: FriendOnAnime, total: number | null): string {
  const score = f.score != null ? ` · ★${f.score}` : "";
  switch (f.status) {
    case "watching":
      return `on ep ${f.progress}${total ? ` of ${total}` : ""}${score}`;
    case "completed":
      return `finished${score}`;
    case "paused":
      return `paused at ep ${f.progress}${score}`;
    case "planning":
      return "plans to watch";
    case "dropped":
      return `dropped${f.progress > 0 ? ` at ep ${f.progress}` : ""}${score}`;
    default:
      return f.status;
  }
}

/** Newest-first API pages become oldest-first bubbles. */
export function chronological(pages: DirectMessage[][]): DirectMessage[] {
  return pages.flat().slice().sort((a, b) => a.id - b.id);
}

/** Whether two consecutive bubbles should collapse into one visual group. */
export function sameGroup(a: DirectMessage, b: DirectMessage, gapMs = 5 * 60_000): boolean {
  return (
    a.mine === b.mine &&
    Math.abs(new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) <= gapMs
  );
}
