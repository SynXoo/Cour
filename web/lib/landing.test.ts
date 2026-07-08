import { describe, expect, it } from "vitest";
import type { AnimeSummary, ScheduleEntry, ThreadComment, TrendingThread } from "@/lib/api/client";
import { agoLabel, buildTicker, heroCovers, threadHref, tonightEntries } from "./landing";

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

function mkComment(over: Partial<ThreadComment> & Pick<ThreadComment, "id">): ThreadComment {
  return {
    thread_id: 1,
    parent_id: null,
    author: { username: `user${over.id}`, avatar_url: null },
    body: `body ${over.id}`,
    timestamp_seconds: null,
    has_spoilers: false,
    deleted: false,
    reactions: [],
    created_at: NOW.toISOString(),
    ...over,
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

describe("buildTicker", () => {
  it("filters spoilers and deletions, sorts newest first across threads, and caps", () => {
    const a = mkThread({
      animeId: 1,
      threadId: 10,
      episode: { number: 4, title: null, airing_at: null },
    });
    const b = mkThread({ animeId: 2, threadId: 20 });
    const comments = new Map([
      [
        10,
        [
          mkComment({ id: 1, created_at: minsAgo(10) }),
          mkComment({ id: 2, created_at: minsAgo(1), has_spoilers: true }),
          mkComment({ id: 3, created_at: minsAgo(2), deleted: true, body: "[removed]" }),
        ],
      ],
      [20, [mkComment({ id: 4, created_at: minsAgo(5) })]],
    ]);

    const items = buildTicker([a, b], comments, NOW);
    expect(items.map((i) => i.id)).toEqual([4, 1]); // spoiler + deleted gone, newest first
    expect(items[0]).toMatchObject({
      animeTitle: "Title 2",
      episode: null,
      href: "/anime/2/discussion",
      ago: "5m ago",
    });
    expect(items[1]).toMatchObject({ episode: 4, href: "/anime/1/episode/4" });
  });

  it("caps the feed and ignores threads without fetched comments", () => {
    const t = mkThread({ animeId: 1, threadId: 10 });
    const quiet = mkThread({ animeId: 2, threadId: 20 });
    const many = Array.from({ length: 12 }, (_, i) =>
      mkComment({ id: i + 1, created_at: minsAgo(i) }),
    );
    const items = buildTicker([t, quiet], new Map([[10, many]]), NOW);
    expect(items).toHaveLength(8);
    expect(items[0].id).toBe(1);
  });
});
