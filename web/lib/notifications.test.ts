import { describe, expect, it } from "vitest";
import type { AnimeSummary } from "@/lib/api/client";
import { describeNotification, relativeTime, type Notification } from "./notifications";

const anime: AnimeSummary = {
  id: 7,
  slug: "frieren",
  title: "Sousou no Frieren",
  title_english: "Frieren",
  cover_image: null,
  cover_color: null,
  format: "TV",
  status: "RELEASING",
  season: "SUMMER",
  season_year: 2026,
  episodes_count: 12,
  average_score: null,
  popularity: 100,
  genres: [],
  next_airing_at: null,
  next_airing_episode: null,
};

function notif(over: Partial<Notification>): Notification {
  return {
    id: 1,
    type: "new_follower",
    actor: { username: "sam", avatar_url: null },
    anime: null,
    ref_id: null,
    payload: {},
    read: false,
    created_at: "2026-09-04T12:00:00Z",
    ...over,
  } as Notification;
}

describe("describeNotification", () => {
  it("sends an episode reply to that episode's thread", () => {
    const { href, text } = describeNotification(
      notif({ type: "comment_reply", anime, payload: { kind: "episode", episode: 4 } }),
    );
    expect(href).toBe("/anime/7/episode/4");
    expect(text).toContain("replied to your comment on Frieren");
  });

  it("sends a series reply to the discussion tab", () => {
    const { href } = describeNotification(
      notif({ type: "comment_reply", anime, payload: { kind: "series" } }),
    );
    expect(href).toBe("/anime/7/discussion");
  });

  it("points a follow at the follower's profile", () => {
    expect(describeNotification(notif({ type: "new_follower" }))).toEqual({
      text: "followed you",
      href: "/users/sam",
    });
  });

  it("falls back to the schedule when an aired episode has no anime", () => {
    const { href, text } = describeNotification(
      notif({ type: "episode_aired", actor: null, payload: { episode: 3 } }),
    );
    expect(href).toBe("/schedule");
    expect(text).toContain("a show you watch");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  it("compresses each unit down to one character", () => {
    expect(relativeTime("2026-09-04T11:59:30Z", now)).toBe("now");
    expect(relativeTime("2026-09-04T11:20:00Z", now)).toBe("40m");
    expect(relativeTime("2026-09-04T04:00:00Z", now)).toBe("8h");
    expect(relativeTime("2026-09-01T12:00:00Z", now)).toBe("3d");
    expect(relativeTime("2026-08-14T12:00:00Z", now)).toBe("3w");
  });

  it("never runs backwards on a clock-skewed future stamp", () => {
    expect(relativeTime("2026-09-04T12:05:00Z", now)).toBe("now");
  });
});
