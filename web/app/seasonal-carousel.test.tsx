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

  it("only the first copy is real; loop filler is inert and hidden from a11y", () => {
    const items = [anime(1), anime(2), anime(3)];
    const { container } = render(<SeasonalCarousel anime={items} />);

    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(4); // 2 halves × 2 reps
    expect(lists[0]).not.toHaveAttribute("aria-hidden");
    expect(lists[0]).not.toHaveAttribute("inert");
    for (const filler of [...lists].slice(1)) {
      expect(filler).toHaveAttribute("aria-hidden", "true");
      expect(filler).toHaveAttribute("inert");
      expect(filler.className).toContain("motion-reduce:hidden");
    }
    // Every copy carries the full set of card links.
    expect(container.querySelectorAll("a")).toHaveLength(12);
    expect(lists[0].querySelectorAll("a")[0]).toHaveAttribute("href", "/anime/1/anime-1");
  });

  it("drifts on the shared marquee track", () => {
    const { container } = render(<SeasonalCarousel anime={[anime(1)]} />);
    expect(container.querySelector(".landing-marquee")).not.toBeNull();
  });
});
