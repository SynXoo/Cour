import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnimeSummary } from "@/lib/api/client";
import { SeasonalCarousel } from "./seasonal-carousel";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

function anime(id: number, cover: string | null = `cover-${id}.jpg`): AnimeSummary {
  return {
    id,
    slug: `anime-${id}`,
    title: `Title ${id}`,
    title_english: null,
    cover_image: cover,
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
  };
}

describe("SeasonalCarousel", () => {
  it("renders nothing without covers", () => {
    const { container } = render(<SeasonalCarousel anime={[anime(1, null)]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is one browsable row: every card real, nothing duplicated for a loop", () => {
    const items = [anime(1), anime(2), anime(3)];
    const { container } = render(<SeasonalCarousel anime={items} />);

    expect(container.querySelectorAll("ul")).toHaveLength(1);
    expect(container.querySelector(".landing-marquee")).toBeNull();
    expect(container.querySelector("[inert]")).toBeNull();
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", "/anime/1/anime-1");
  });

  it("drops coverless titles", () => {
    const { container } = render(<SeasonalCarousel anime={[anime(1), anime(2, null)]} />);
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });
});
