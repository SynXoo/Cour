import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnimeSummary, ScheduleEntry } from "@/lib/api/client";
import { EveningTimeline } from "./evening-timeline";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

const getMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  browserApi: { GET: (...args: unknown[]) => getMock(...args) },
}));

const NOW = new Date("2026-07-08T20:00:00Z");
const at = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

function anime(id: number, over: Partial<AnimeSummary> = {}): AnimeSummary {
  return {
    id,
    slug: `show-${id}`,
    title: `Show ${id}`,
    title_english: null,
    cover_image: `cover-${id}.jpg`,
    cover_color: null,
    format: "TV",
    status: "RELEASING",
    season: "SUMMER",
    season_year: 2026,
    episodes_count: 12,
    average_score: 80,
    popularity: 1000,
    genres: ["Drama", "Fantasy"],
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

function mount(entries: ScheduleEntry[], rooms = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EveningTimeline entries={entries} rooms={rooms} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.setSystemTime?.(NOW);
  getMock.mockResolvedValue({
    data: { ...anime(1), description: "A very synopsis-shaped synopsis." },
    error: undefined,
  });
});

afterEach(() => vi.clearAllMocks());

describe("EveningTimeline", () => {
  it("pins each episode as a thread link at its air time", () => {
    mount([sched(1, 9, at(2)), sched(2, 4, at(6))]);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/anime/1/episode/9");
    expect(links[0].getAttribute("aria-label")).toMatch(/Show 1 — Ep 9/);
    // Positioned along the axis: 3h/25h = 12%, 7h/25h = 28%.
    expect(parseFloat((links[0].parentElement as HTMLElement).style.left)).toBeCloseTo(12, 5);
    expect(parseFloat((links[1].parentElement as HTMLElement).style.left)).toBeCloseTo(28, 5);
  });

  it("opens a preview on hover and lazy-loads the synopsis once", async () => {
    mount([sched(1, 9, at(2))], { "1:9": { presence: 3, comments: 7 } });
    fireEvent.mouseEnter(screen.getByRole("link").parentElement!);

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Show 1");
    expect(tip).toHaveTextContent(/Ep 9 ·/);
    expect(tip).toHaveTextContent("Drama · Fantasy");
    expect(tip).toHaveTextContent("3 in the room already");
    await waitFor(() =>
      expect(tip).toHaveTextContent("A very synopsis-shaped synopsis."),
    );
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith("/anime/{id}", { params: { path: { id: 1 } } });
  });

  it("closes the preview on Escape and renders nothing when empty", () => {
    const { container } = mount([sched(1, 9, at(2))]);
    const link = screen.getByRole("link");
    fireEvent.focus(link);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.keyDown(link, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    container.remove();
    const empty = mount([]);
    expect(empty.container).toBeEmptyDOMElement();
  });
});
