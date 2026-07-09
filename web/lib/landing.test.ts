import { describe, expect, it } from "vitest";
import type { AnimeSummary, ScheduleEntry, TrendingThread } from "@/lib/api/client";
import { agoLabel, buildRooms, heroCovers, threadHref, tonightEntries } from "./landing";

const NOW = new Date("2026-07-08T20:00:00Z");

function mkAnime(over: Partial<AnimeSummary> & Pick<AnimeSummary, "id">): AnimeSummary {
  return {
    slug: `anime-${over.id}`,
    title: `Title ${over.id}`,
    title_english: null,
    cover_image: null,
    cover_color: null,
    format: "TV",
    status: "RELEASING",
    season: "SUMMER",
    season_year: 2026,
    episodes_count: 12,
    average_score: null,
    popularity: 0,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
    ...over,
  };
}

function mkThread(
  over: Partial<TrendingThread> & { animeId: number; threadId: number },
): TrendingThread {
  const { animeId, threadId, ...rest } = over;
  return {
    thread: {
      id: threadId,
      anime_id: animeId,
      kind: rest.episode ? "episode" : "series",
      comment_count: 5,
      last_activity_at: NOW.toISOString(),
    },
    anime: mkAnime({ id: animeId }),
    episode: null,
    recent_comments: 3,
    presence: 0,
    ...rest,
  };
}

const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const hoursAhead = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

describe("threadHref", () => {
  it("routes episode threads to the episode page", () => {
    const t = mkThread({
      animeId: 7,
      threadId: 1,
      episode: { number: 9, title: null, airing_at: null },
    });
    expect(threadHref(t)).toBe("/anime/7/episode/9");
  });

  it("routes series boards to the discussion page", () => {
    expect(threadHref(mkThread({ animeId: 7, threadId: 1 }))).toBe("/anime/7/discussion");
  });
});

describe("tonightEntries", () => {
  const entry = (id: number, airingAt: string): ScheduleEntry => ({
    anime: mkAnime({ id }),
    episode: 1,
    airing_at: airingAt,
  });

  it("keeps the next 24 hours and the just-aired grace hour", () => {
    const tonight = entry(1, hoursAhead(3));
    const justAired = entry(2, minsAgo(30));
    const tomorrow = entry(3, hoursAhead(30));
    const longGone = entry(4, minsAgo(120));
    expect(tonightEntries([tonight, justAired, tomorrow, longGone], NOW)).toEqual([
      tonight,
      justAired,
    ]);
  });

  it("returns empty when nothing airs in the window", () => {
    expect(tonightEntries([entry(1, hoursAhead(48))], NOW)).toEqual([]);
  });
});

describe("agoLabel", () => {
  it("scales from seconds to days", () => {
    expect(agoLabel(minsAgo(0), NOW)).toBe("just now");
    expect(agoLabel(minsAgo(5), NOW)).toBe("5m ago");
    expect(agoLabel(minsAgo(90), NOW)).toBe("1h ago");
    expect(agoLabel(minsAgo(60 * 24 * 3), NOW)).toBe("3d ago");
  });

  it("clamps future timestamps to just now", () => {
    expect(agoLabel(hoursAhead(1), NOW)).toBe("just now");
  });
});

describe("heroCovers", () => {
  const withCover = (over: Partial<AnimeSummary> & Pick<AnimeSummary, "id">) =>
    mkAnime({ cover_image: `cover-${over.id}.jpg`, ...over });

  it("unions trending rank with the pool's all-time-popularity picks", () => {
    // 20 modestly popular trending titles, then a legacy megahit at the tail:
    // rank alone would never surface it, popularity must.
    const trending = Array.from({ length: 20 }, (_, i) =>
      withCover({ id: i + 1, popularity: 1000 - i }),
    );
    const megahit = withCover({ id: 99, title: "Death Note", popularity: 900_000 });
    const picks = heroCovers([...trending, megahit], [], 12);
    expect(picks.map((a) => a.id)).toContain(99);
    expect(picks[0].id).toBe(1); // rank picks still lead
    // "Title 10" must not read as a sequel of "Title 1" (word boundary).
    expect(picks).toHaveLength(12);
  });

  it("skips missing covers, duplicate ids, and same-franchise sequels", () => {
    const aot = withCover({ id: 1, title: "Attack on Titan", popularity: 10 });
    const aotS2 = withCover({ id: 2, title: "Attack on Titan Season 2", popularity: 9 });
    const coverless = mkAnime({ id: 3, popularity: 8 }); // cover_image: null
    const seasonalDupe = withCover({ id: 1, title: "Attack on Titan", popularity: 10 });
    const fresh = withCover({ id: 4, title: "Mebius Dust", popularity: 1 });
    const picks = heroCovers([aot, aotS2, coverless], [seasonalDupe, fresh]);
    expect(picks.map((a) => a.id)).toEqual([1, 4]);
  });

  it("fills from seasonal when trending runs dry", () => {
    const seasonal = Array.from({ length: 4 }, (_, i) => withCover({ id: 50 + i }));
    expect(heroCovers([], seasonal).map((a) => a.id)).toEqual([50, 51, 52, 53]);
  });
});

describe("buildRooms", () => {
  it("maps trending threads to rooms in rank order — no comment text anywhere", () => {
    const ep = mkThread({
      animeId: 1,
      threadId: 10,
      episode: { number: 4, title: null, airing_at: null },
      presence: 3,
    });
    ep.thread.last_activity_at = minsAgo(5);
    const series = mkThread({ animeId: 2, threadId: 20 });

    const rooms = buildRooms([ep, series], NOW);
    expect(rooms.map((r) => r.threadId)).toEqual([10, 20]); // trending order kept
    expect(rooms[0]).toMatchObject({
      title: "Title 1",
      label: "Ep 4 room",
      commentCount: 5,
      recent: 3,
      presence: 3,
      ago: "5m ago",
      href: "/anime/1/episode/4",
    });
    expect(rooms[1]).toMatchObject({ label: "Series room", href: "/anime/2/discussion" });
    for (const room of rooms) {
      expect(Object.values(room).join(" ")).not.toContain("body"); // rooms carry stats, not speech
    }
  });

  it("drops dead rooms unless someone is present", () => {
    const dead = mkThread({ animeId: 1, threadId: 10 });
    dead.thread.comment_count = 0;
    dead.recent_comments = 0;
    const lurkers = mkThread({ animeId: 2, threadId: 20, presence: 2 });
    lurkers.thread.comment_count = 0;

    expect(buildRooms([dead, lurkers], NOW).map((r) => r.threadId)).toEqual([20]);
  });
});
