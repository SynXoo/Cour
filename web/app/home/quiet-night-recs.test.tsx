import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnimeSummary } from "@/lib/api/client";
import { QuietNightRecs } from "./quiet-night-recs";

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

function anime(id: number, title: string): AnimeSummary {
  return {
    id,
    slug: `s-${id}`,
    title,
    title_english: null,
    cover_image: `c-${id}.jpg`,
    cover_color: null,
    format: "TV",
    status: "RELEASING",
    season: "SUMMER",
    season_year: 2026,
    episodes_count: 12,
    average_score: 80,
    popularity: 1,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
  };
}

function mount(seasonal: AnimeSummary[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <QuietNightRecs seasonal={seasonal} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("QuietNightRecs", () => {
  it("rails personalized picks with a link to the full page", async () => {
    getMock.mockResolvedValue({
      data: { data: [{ anime: anime(1, "Picked For You"), reasons: [] }], cold_start: false },
      error: undefined,
    });
    mount([anime(9, "Seasonal Thing")]);
    expect(await screen.findByText("Picked For You")).toBeInTheDocument();
    expect(screen.getByText(/picked for your taste/)).toBeInTheDocument();
    expect(screen.queryByText("Seasonal Thing")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "More for you →" })).toHaveAttribute(
      "href",
      "/recommendations",
    );
  });

  it("falls back to seasonal picks when the recommender is empty", async () => {
    getMock.mockResolvedValue({ data: { data: [], cold_start: true }, error: undefined });
    mount([anime(9, "Seasonal Thing")]);
    expect(await screen.findByText("Seasonal Thing")).toBeInTheDocument();
    expect(screen.getByText(/big this season/)).toBeInTheDocument();
  });
});
