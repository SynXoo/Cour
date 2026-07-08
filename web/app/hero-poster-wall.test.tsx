import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnimeSummary } from "@/lib/api/client";
import { HeroPosterWall } from "./hero-poster-wall";

// The wall only needs an <img>; next/image's loader adds nothing under test.
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

const covers = (n: number) => Array.from({ length: n }, (_, i) => anime(i + 1));

describe("HeroPosterWall", () => {
  it("renders nothing when the wall would be sparse", () => {
    const { container } = render(<HeroPosterWall anime={covers(7)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is decorative: hidden from the tree, rows doubled for the seamless loop", () => {
    const { container } = render(<HeroPosterWall anime={covers(10)} />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    // 10 covers split across 2 rows, each row rendered twice.
    expect(container.querySelectorAll("img")).toHaveLength(20);
    const rows = container.querySelectorAll(".hero-marquee");
    expect(rows).toHaveLength(2);
    expect(rows[1].className).toContain("hero-marquee-reverse");
    for (const img of container.querySelectorAll("img")) {
      expect(img).toHaveAttribute("alt", "");
    }
  });

  it("drops coverless titles before deciding it has enough", () => {
    const mixed = [...covers(7), anime(8, null), anime(9, null)];
    const { container } = render(<HeroPosterWall anime={mixed} />);
    expect(container).toBeEmptyDOMElement();
  });
});
