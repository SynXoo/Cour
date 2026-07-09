import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TonightRoom } from "@/lib/threads-hub";
import { TonightRail } from "./tonight-rail";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

const iso = (hoursFromNow: number) =>
  new Date(Date.now() + hoursFromNow * 3_600_000).toISOString();

function room(over: Partial<TonightRoom> = {}): TonightRoom {
  return {
    animeId: 1,
    title: "Show One",
    cover: "cover-1.jpg",
    coverColor: "#abcdef",
    episode: 9,
    airingAt: iso(2),
    href: "/anime/1/episode/9",
    presence: 0,
    comments: 0,
    ...over,
  };
}

describe("TonightRail", () => {
  it("links each room to its episode thread", () => {
    render(<TonightRail rooms={[room()]} />);
    expect(screen.getByRole("link", { name: /Show One/ })).toHaveAttribute(
      "href",
      "/anime/1/episode/9",
    );
  });

  it("flags an already-aired room LIVE, an upcoming one not", () => {
    render(
      <TonightRail
        rooms={[
          room({ animeId: 1, title: "Aired", href: "/anime/1/episode/9", airingAt: iso(-0.5) }),
          room({ animeId: 2, title: "Soon", href: "/anime/2/episode/3", airingAt: iso(3) }),
        ]}
      />,
    );
    const aired = screen.getByRole("link", { name: /Aired/ });
    const soon = screen.getByRole("link", { name: /Soon/ });
    expect(within(aired).getByText("LIVE")).toBeInTheDocument();
    expect(within(soon).queryByText("LIVE")).not.toBeInTheDocument();
  });

  it("shows live stats when the room is hot, a quiet nudge otherwise", () => {
    render(
      <TonightRail
        rooms={[
          room({ animeId: 1, title: "Hot", href: "/a/1", presence: 5, comments: 12 }),
          room({ animeId: 2, title: "Quiet", href: "/a/2" }),
        ]}
      />,
    );
    const hot = screen.getByRole("link", { name: /Hot/ });
    expect(within(hot).getByText(/5 in there/)).toBeInTheDocument();
    expect(within(hot).getByText(/12 comments/)).toBeInTheDocument();
    const quiet = screen.getByRole("link", { name: /Quiet/ });
    expect(within(quiet).getByText(/still quiet/)).toBeInTheDocument();
  });
});
