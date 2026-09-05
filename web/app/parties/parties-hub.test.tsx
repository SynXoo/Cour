import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchPartySummary } from "@/lib/hooks/use-parties";
import type { HostableEpisode } from "@/lib/parties-hub";
import { PartiesHub } from "./parties-hub";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

let flag: boolean | undefined = true;
vi.mock("@/lib/hooks/use-features", () => ({
  useFeatures: () => ({ data: flag === undefined ? undefined : { watch_parties: flag } }),
}));

const open: WatchPartySummary[] = [];
vi.mock("@/lib/hooks/use-parties", () => ({
  useOpenParties: () => ({ data: open }),
}));

const party = (id: number, watching: number): WatchPartySummary =>
  ({
    id,
    anime: { id: 1, slug: "s", title: "Show", title_english: null, cover_image: null },
    episode: { number: 4, title: null, airing_at: null },
    host: { username: "rin", avatar_url: null },
    visibility: "public",
    created_at: "2026-09-05T20:00:00Z",
    closed_at: null,
    watching,
  }) as unknown as WatchPartySummary;

const HOUR = 3_600_000;
const ep = (offsetMs: number, over: Partial<HostableEpisode> = {}): HostableEpisode => ({
  animeId: 7,
  title: "Frieren",
  cover: null,
  coverColor: null,
  episode: 12,
  airingAt: new Date(Date.now() + offsetMs).toISOString(),
  href: "/anime/7/episode/12",
  ...over,
});

beforeEach(() => {
  flag = true;
  open.length = 0;
});

/** The stat line splits its number into its own span; match the whole `dd`. */
const stat = (text: string) =>
  screen.getByText(
    (_, el) => el?.tagName === "DD" && el.textContent?.replace(/\s+/g, " ").trim() === text,
  );

describe("PartiesHub", () => {
  it("still sells the feature when no room is open", () => {
    render(<PartiesHub episodes={[]} />);
    // The whole point of the hub: a quiet night is not an empty page.
    expect(screen.getByRole("heading", { name: /Open right now/ })).toBeInTheDocument();
    expect(screen.getByText(/No room is open at the moment/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How a party works" })).toBeInTheDocument();
    expect(screen.getByText(/never hosts, proxies or links to video/)).toBeInTheDocument();
    expect(stat("0 rooms open")).toBeInTheDocument();
  });

  it("lists the open rooms and totals the people in them", () => {
    open.push(party(1, 3), party(2, 4));
    render(<PartiesHub episodes={[]} />);
    expect(stat("2 rooms open")).toBeInTheDocument();
    expect(stat("7 watching together")).toBeInTheDocument();
    expect(
      screen.getAllByRole("link").map((l) => l.getAttribute("href")),
    ).toEqual(expect.arrayContaining(["/parties/1", "/parties/2"]));
  });

  it("labels an episode already out as hostable and one still to air as soon", () => {
    render(
      <PartiesHub
        episodes={[
          ep(-HOUR, { title: "Already out", animeId: 2, href: "/anime/2/episode/2" }),
          ep(2 * HOUR, { title: "Later", animeId: 1, href: "/anime/1/episode/1" }),
        ]}
      />,
    );
    // The server hands the order over; the row only decides its own label.
    const rows = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href")?.startsWith("/anime/"));
    expect(rows.map((l) => l.getAttribute("href"))).toEqual([
      "/anime/2/episode/2",
      "/anime/1/episode/1",
    ]);
    expect(screen.getByText("out now")).toBeInTheDocument();
    expect(screen.getByText("Start")).toBeInTheDocument();
    expect(screen.getByText("Soon")).toBeInTheDocument();
  });

  it("says so plainly when the deployment has the flag off", () => {
    flag = false;
    render(<PartiesHub episodes={[ep(-HOUR)]} />);
    expect(screen.getByText(/switched off on this deployment/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Open right now/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/rooms open/)).not.toBeInTheDocument();
  });
});
