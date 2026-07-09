import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnimeSummary, ScheduleEntry } from "@/lib/api/client";
import { YourEvening } from "./your-evening";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

vi.mock("@/lib/auth/session", () => ({ useSession: vi.fn() }));
vi.mock("@/lib/hooks/use-list", () => ({ useMyList: vi.fn() }));
// Both children own react-query fetches; their behavior has its own tests.
vi.mock("./evening-timeline", () => ({
  EveningTimeline: () => <div data-testid="evening-timeline" />,
}));
vi.mock("./quiet-night-recs", () => ({
  QuietNightRecs: () => <div data-testid="quiet-night-recs" />,
}));

import { useSession } from "@/lib/auth/session";
import { useMyList } from "@/lib/hooks/use-list";

const mockSession = vi.mocked(useSession);
const mockList = vi.mocked(useMyList);

const NOW = new Date("2026-07-08T20:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

function anime(id: number, over: Partial<AnimeSummary> = {}): AnimeSummary {
  return {
    id,
    slug: `show-${id}`,
    title: `Show ${id}`,
    title_english: null,
    cover_image: `cover-${id}.jpg`,
    cover_color: "#8b5cf6",
    format: "TV",
    status: "RELEASING",
    season: "SUMMER",
    season_year: 2026,
    episodes_count: 12,
    average_score: 80,
    popularity: 1000,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
    ...over,
  };
}

const sched = (animeId: number, episode: number, airingAt: string): ScheduleEntry => ({
  anime: anime(animeId),
  episode,
  airing_at: airingAt,
});

const listEntry = (animeId: number) => ({
  anime_id: animeId,
  status: "watching" as const,
  score: null,
  progress: 3,
  started_on: null,
  finished_on: null,
  updated_at: NOW.toISOString(),
  anime: anime(animeId),
});

function session(status: "loading" | "authed" | "anon") {
  mockSession.mockReturnValue({ status } as ReturnType<typeof useSession>);
}
function list(data: ReturnType<typeof listEntry>[] | undefined, isPending = false) {
  mockList.mockReturnValue({ data, isPending } as ReturnType<typeof useMyList>);
}

const seasonal = [anime(90, { title: "Seasonal Pick" })];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("YourEvening", () => {
  it("shows a skeleton while the session or list resolves", () => {
    session("loading");
    list(undefined, true);
    render(<YourEvening schedule={[]} rooms={{}} seasonal={seasonal} />);
    expect(screen.getByTestId("evening-skeleton")).toBeInTheDocument();
  });

  it("spotlights the soonest episode and rails the rest, with room stats", () => {
    session("authed");
    list([listEntry(1), listEntry(2), listEntry(3)]);
    const schedule = [
      sched(2, 4, at(5)),
      sched(1, 9, at(2)), // soonest → spotlight
      sched(3, 7, at(8)),
      sched(9, 1, at(3)), // not on the list
    ];
    render(
      <YourEvening
        schedule={schedule}
        rooms={{ "1:9": { presence: 9, comments: 42 }, "2:4": { presence: 2, comments: 5 } }}
        seasonal={seasonal}
      />,
    );

    expect(screen.getByText("Up next on your list")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Show 1" })).toBeInTheDocument();
    expect(screen.getByText(/9 in the room now/)).toBeInTheDocument();
    expect(screen.getByText(/42 comments so far/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Into the thread" })).toHaveAttribute(
      "href",
      "/anime/1/episode/9",
    );
    // Rail: the other two of mine, not the stranger's show.
    expect(screen.getByText("Show 2")).toBeInTheDocument();
    expect(screen.getByText(/2 in there now/)).toBeInTheDocument();
    expect(screen.getByText("Show 3")).toBeInTheDocument();
    expect(screen.queryByText("Show 9")).not.toBeInTheDocument();
    // Desktop gets the timeline alongside (CSS decides which one shows).
    expect(screen.getByTestId("evening-timeline")).toBeInTheDocument();
  });

  it("marks a just-aired headliner as live", () => {
    session("authed");
    list([listEntry(1)]);
    render(
      <YourEvening schedule={[sched(1, 9, at(-0.5))]} rooms={{}} seasonal={seasonal} />,
    );
    expect(screen.getByText("Live — the room is open")).toBeInTheDocument();
    expect(screen.getByText("airing now")).toBeInTheDocument();
  });

  it("falls back to the week ahead plus recommendations on a quiet night", () => {
    session("authed");
    list([listEntry(1)]);
    render(
      <YourEvening schedule={[sched(1, 5, at(48))]} rooms={{}} seasonal={seasonal} />,
    );
    expect(screen.getByText(/Nothing on your list airs in the next 24 hours/)).toBeInTheDocument();
    expect(screen.getByText(/Ep 5 ·/)).toBeInTheDocument();
    expect(screen.getByText(/in 2d 0h/)).toBeInTheDocument();
    expect(screen.getByTestId("quiet-night-recs")).toBeInTheDocument();
  });

  it("still offers recommendations when even the week is clear", () => {
    session("authed");
    list([listEntry(1)]);
    render(<YourEvening schedule={[]} rooms={{}} seasonal={seasonal} />);
    expect(screen.getByText(/the week's schedule is clear/)).toBeInTheDocument();
    expect(screen.getByTestId("quiet-night-recs")).toBeInTheDocument();
  });

  it("pitches seasonal picks when the watching list is empty", () => {
    session("authed");
    list([]);
    render(<YourEvening schedule={[]} rooms={{}} seasonal={seasonal} />);
    expect(screen.getByText("Your evening is unwritten.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse the season" })).toHaveAttribute(
      "href",
      "/seasonal",
    );
    expect(screen.getByRole("link", { name: "Import your list" })).toHaveAttribute(
      "href",
      "/settings/import",
    );
    expect(screen.getByText("Seasonal Pick")).toBeInTheDocument();
  });

  it("asks a stale session to sign back in", () => {
    session("anon");
    list(undefined);
    render(<YourEvening schedule={[]} rooms={{}} seasonal={seasonal} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});
