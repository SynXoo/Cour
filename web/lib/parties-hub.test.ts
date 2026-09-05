import { describe, expect, it } from "vitest";
import type { ScheduleEntry } from "@/lib/api/client";
import {
  HOSTABLE_FUTURE_HOURS,
  HOSTABLE_PAST_HOURS,
  hostableEpisodes,
  hostableWindow,
} from "./parties-hub";

const NOW = new Date("2026-09-05T21:00:00Z");
const HOUR = 3_600_000;

const at = (hoursFromNow: number) =>
  new Date(NOW.getTime() + hoursFromNow * HOUR).toISOString();

const entry = (id: number, title: string, episode: number, hoursFromNow: number): ScheduleEntry =>
  ({
    anime: {
      id,
      slug: `s-${id}`,
      title,
      title_english: null,
      cover_image: null,
      cover_color: null,
    },
    episode,
    airing_at: at(hoursFromNow),
  }) as unknown as ScheduleEntry;

describe("hostableWindow", () => {
  it("reaches a day back and half a day forward", () => {
    const { from, to } = hostableWindow(NOW);
    expect(new Date(from).getTime()).toBe(NOW.getTime() - HOSTABLE_PAST_HOURS * HOUR);
    expect(new Date(to).getTime()).toBe(NOW.getTime() + HOSTABLE_FUTURE_HOURS * HOUR);
  });
});

describe("hostableEpisodes", () => {
  it("leads with the freshest episode already out, then counts forward", () => {
    const out = hostableEpisodes(
      [
        entry(1, "In two hours", 3, 2),
        entry(2, "Out six hours ago", 8, -6),
        entry(3, "In twenty minutes", 1, 1 / 3),
        entry(4, "Out one hour ago", 5, -1),
      ],
      NOW,
    );
    expect(out.map((e) => e.title)).toEqual([
      "Out one hour ago",
      "Out six hours ago",
      "In twenty minutes",
      "In two hours",
    ]);
  });

  it("drops anything outside the window, so a whole week can be handed over", () => {
    const out = hostableEpisodes(
      [
        entry(1, "Yesterday, just inside", 1, -23),
        entry(2, "Two days ago", 2, -48),
        entry(3, "Tomorrow evening", 3, 30),
        entry(4, "This evening", 4, 6),
      ],
      NOW,
    );
    expect(out.map((e) => e.title)).toEqual(["Yesterday, just inside", "This evening"]);
  });

  it("shapes each entry for the row, episode page href included", () => {
    const [row] = hostableEpisodes([entry(42, "Frieren", 12, -2)], NOW);
    expect(row).toMatchObject({
      animeId: 42,
      title: "Frieren",
      episode: 12,
      href: "/anime/42/episode/12",
      airingAt: at(-2),
    });
  });

  it("is empty rather than throwing on an empty schedule", () => {
    expect(hostableEpisodes([], NOW)).toEqual([]);
  });
});
