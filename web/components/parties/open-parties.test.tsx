import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchPartySummary } from "@/lib/hooks/use-parties";
import { OpenParties, partyCountLabel } from "./open-parties";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

let flag = true;
vi.mock("@/lib/hooks/use-features", () => ({
  useFeatures: () => ({ data: { watch_parties: flag } }),
}));

const data: WatchPartySummary[] = [];
vi.mock("@/lib/hooks/use-parties", () => ({
  useOpenParties: () => ({ data }),
}));

const party = (id: number, over: Partial<WatchPartySummary> = {}): WatchPartySummary => ({
  id,
  anime: {
    id: 1,
    slug: "show",
    title: "Show",
    title_english: "The Show",
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
  },
  episode: { number: 4, title: null, airing_at: null },
  host: { username: "rin", avatar_url: null },
  visibility: "public",
  created_at: "2026-09-05T20:00:00Z",
  closed_at: null,
  watching: 3,
  ...over,
});

describe("OpenParties", () => {
  beforeEach(() => {
    flag = true;
    data.length = 0;
  });

  it("renders nothing when no room is open and the caller asked to hide", () => {
    const { container } = render(<OpenParties />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a way into the hub when no room is open", () => {
    render(<OpenParties whenEmpty="invite" />);
    expect(screen.getByTestId("parties-invite")).toHaveAttribute("href", "/parties");
    expect(screen.getByText(/start one on tonight/i)).toBeInTheDocument();
  });

  it("stays silent with the flag off, invitation or not", () => {
    flag = false;
    const { container } = render(<OpenParties whenEmpty="invite" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists rooms with episode, host, visibility and live counts", () => {
    data.push(party(1), party(2, { visibility: "followers", watching: 0, host: { username: "sue", avatar_url: null } }));
    render(<OpenParties heading="Watching together tonight" />);
    expect(screen.getByRole("heading", { name: /Watching together tonight/ })).toBeInTheDocument();
    expect(screen.getByText("2 rooms · 3 watching")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/parties",
      "/parties/1",
      "/parties/2",
    ]);
    expect(screen.getByText(/Ep 4 · @rin/)).toBeInTheDocument();
    expect(screen.getByText("followers")).toBeInTheDocument();
    expect(screen.getByLabelText("3 watching")).toBeInTheDocument();
  });

  it("shows at most `limit` rooms but counts them all", () => {
    data.push(party(1), party(2), party(3));
    render(<OpenParties limit={2} />);
    expect(screen.getByText("3 rooms · 9 watching")).toBeInTheDocument();
    expect(screen.getAllByRole("link").map((l) => l.getAttribute("href"))).toEqual([
      "/parties",
      "/parties/1",
      "/parties/2",
    ]);
  });
});

describe("partyCountLabel", () => {
  it("phrases rooms and viewers", () => {
    expect(partyCountLabel([party(1, { watching: 0 })])).toBe("1 room");
    expect(partyCountLabel([party(1), party(2, { watching: 1 })])).toBe("2 rooms · 4 watching");
  });
});
