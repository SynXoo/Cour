import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnimeSummary } from "@/lib/api/client";
import { ContinueWatching } from "./continue-watching";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

vi.mock("@/lib/auth/session", () => ({ useSession: vi.fn() }));
vi.mock("@/lib/hooks/use-list", () => ({
  useMyList: vi.fn(),
  useUpsertEntry: vi.fn(),
}));

import { useSession } from "@/lib/auth/session";
import { useMyList, useUpsertEntry } from "@/lib/hooks/use-list";

const mockSession = vi.mocked(useSession);
const mockList = vi.mocked(useMyList);
const mockUpsert = vi.mocked(useUpsertEntry);

function anime(id: number, over: Partial<AnimeSummary> = {}): AnimeSummary {
  return {
    id,
    slug: `show-${id}`,
    title: `Show ${id}`,
    title_english: null,
    cover_image: `cover-${id}.jpg`,
    cover_color: "#22c55e",
    format: "TV",
    status: "RELEASING",
    season: "SUMMER",
    season_year: 2026,
    episodes_count: 12,
    average_score: 80,
    popularity: 1000,
    genres: [],
    next_airing_at: "2026-07-10T20:00:00Z",
    next_airing_episode: 10,
    ...over,
  };
}

const entry = (animeId: number, progress: number, animeOver: Partial<AnimeSummary> = {}) => ({
  anime_id: animeId,
  status: "watching" as const,
  score: null,
  progress,
  started_on: null,
  finished_on: null,
  updated_at: "2026-07-08T12:00:00Z",
  anime: anime(animeId, animeOver),
});

afterEach(() => vi.clearAllMocks());

function setup(entries: ReturnType<typeof entry>[], status = "authed") {
  mockSession.mockReturnValue({ status } as ReturnType<typeof useSession>);
  mockList.mockReturnValue({ data: entries, isPending: false } as ReturnType<typeof useMyList>);
  const mutate = vi.fn();
  mockUpsert.mockReturnValue({ mutate, isPending: false } as unknown as ReturnType<
    typeof useUpsertEntry
  >);
  return mutate;
}

describe("ContinueWatching", () => {
  it("renders a card per behind show with progress and a discuss link", () => {
    setup([entry(1, 4)]);
    render(<ContinueWatching />);
    expect(screen.getByText("Show 1")).toBeInTheDocument();
    expect(screen.getByText("4/12")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Discuss ep 5 →" })).toHaveAttribute(
      "href",
      "/anime/1/episode/5",
    );
  });

  it("marks the next episode watched on +1", () => {
    const mutate = setup([entry(1, 4)]);
    render(<ContinueWatching />);
    fireEvent.click(screen.getByRole("button", { name: /Mark episode 5 of Show 1 watched/ }));
    expect(mutate).toHaveBeenCalledWith({ status: "watching", progress: 5 });
  });

  it("disappears entirely when the viewer is caught up", () => {
    // Progress 9 with ep 10 airing next = nothing watchable.
    setup([entry(1, 9)]);
    const { container } = render(<ContinueWatching />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing for anonymous viewers", () => {
    setup([entry(1, 2)], "anon");
    const { container } = render(<ContinueWatching />);
    expect(container).toBeEmptyDOMElement();
  });
});
