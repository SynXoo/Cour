import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Episode } from "@/lib/episodes";
import type { FriendOnAnime } from "@/lib/social";
import { EpisodeNavigator } from "./episode-navigator";

const useMyListEntry = vi.fn();
const upsertMutate = vi.fn();
vi.mock("@/lib/hooks/use-list", () => ({
  useMyListEntry: () => useMyListEntry(),
  useUpsertEntry: () => ({ mutate: upsertMutate, isPending: false }),
}));

const useAnimeFriends = vi.fn();
vi.mock("@/lib/hooks/use-social", () => ({
  useAnimeFriends: () => useAnimeFriends(),
}));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const ep = (number: number, airing_at: string | null = "2026-01-01T00:00:00Z", title: string | null = null): Episode => ({
  number,
  title,
  airing_at,
});
/** A finished run: one episode a week, all of it already aired. */
const AIRED_FROM = Date.parse("2020-01-01T00:00:00Z");
const episodes = (n: number) =>
  Array.from({ length: n }, (_, i) => ep(i + 1, new Date(AIRED_FROM + i * 604_800_000).toISOString()));

const friend = (username: string, progress: number): FriendOnAnime => ({
  user: { username, avatar_url: null },
  status: "watching",
  progress,
  score: null,
});

const entry = (progress: number, status = "watching", score: number | null = null) => ({
  data: { anime_id: 1, status, score, progress, started_on: null, finished_on: null, updated_at: "" },
});

describe("EpisodeNavigator — ways in", () => {
  beforeEach(() => {
    useMyListEntry.mockReturnValue({ data: null });
    useAnimeFriends.mockReturnValue({ data: undefined });
    upsertMutate.mockReset();
    push.mockReset();
  });

  it("offers Start and Latest to an anonymous viewer, and no Continue", () => {
    render(<EpisodeNavigator animeId={1} episodes={episodes(12)} episodesCount={12} />);
    expect(screen.getByRole("link", { name: "Start · Ep 1" })).toHaveAttribute(
      "href",
      "/anime/1/episode/1",
    );
    expect(screen.getByRole("link", { name: "Latest · Ep 12" })).toHaveAttribute(
      "href",
      "/anime/1/episode/12",
    );
    expect(screen.queryByRole("link", { name: /continue/i })).not.toBeInTheDocument();
  });

  it("leads with Continue once the viewer is mid-show", () => {
    useMyListEntry.mockReturnValue(entry(7));
    render(<EpisodeNavigator animeId={1} episodes={episodes(12)} episodesCount={12} />);
    expect(screen.getByText("You're on episode 7 of 12 · 5 to go")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue · Ep 8" })).toHaveAttribute(
      "href",
      "/anime/1/episode/8",
    );
  });

  it("jumps to a typed episode number and closes", async () => {
    const user = userEvent.setup();
    render(<EpisodeNavigator animeId={1} episodes={episodes(120)} episodesCount={120} />);

    await user.click(screen.getByRole("combobox", { name: /jump to an episode/i }));
    await user.type(screen.getByPlaceholderText(/episode number or title/i), "73");
    await user.click(await screen.findByRole("option", { name: /Ep 73/ }));

    expect(push).toHaveBeenCalledWith("/anime/1/episode/73");
  });

  it("finds an episode by title", async () => {
    const user = userEvent.setup();
    const eps = [ep(1, null, "Romance Dawn"), ep(2, null, "They Call Him Straw Hat Luffy")];
    render(<EpisodeNavigator animeId={1} episodes={eps} episodesCount={2} />);

    await user.click(screen.getByRole("combobox", { name: /jump to an episode/i }));
    await user.type(screen.getByPlaceholderText(/episode number or title/i), "straw hat");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent("Ep 2");
  });
});

describe("EpisodeNavigator — you are here", () => {
  beforeEach(() => {
    useMyListEntry.mockReturnValue({ data: null });
    useAnimeFriends.mockReturnValue({ data: undefined });
    upsertMutate.mockReset();
    push.mockReset();
  });

  it("renders plain cards without a list entry", () => {
    render(<EpisodeNavigator animeId={1} episodes={episodes(3)} episodesCount={3} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/up next/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark episode/i })).not.toBeInTheDocument();
  });

  it("ticks watched cards, marks the next one, and advances on Watched", async () => {
    useMyListEntry.mockReturnValue(entry(2, "watching", 8));
    const user = userEvent.setup();
    render(<EpisodeNavigator animeId={1} episodes={episodes(4)} episodesCount={4} />);

    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveAttribute("data-state", "watched");
    expect(cards[1]).toHaveAttribute("data-state", "watched");
    expect(cards[2]).toHaveAttribute("data-state", "next");
    expect(cards[3]).toHaveAttribute("data-state", "ahead");
    expect(within(cards[2]).getByText("Up next")).toBeInTheDocument();

    await user.click(within(cards[2]).getByRole("button", { name: /mark episode 3 watched/i }));
    expect(upsertMutate).toHaveBeenCalledWith({ status: "watching", score: 8, progress: 3 });
  });

  it("moves a planning entry to watching on the first tick and keeps the pill on an unaired next episode", async () => {
    useMyListEntry.mockReturnValue(entry(0, "planning"));
    const user = userEvent.setup();
    render(<EpisodeNavigator animeId={1} episodes={[ep(1), ep(2, "2999-01-01T00:00:00Z")]} episodesCount={2} />);
    const cards = screen.getAllByRole("listitem");
    expect(cards[0]).toHaveAttribute("data-state", "next");
    await user.click(within(cards[0]).getByRole("button", { name: /mark episode 1 watched/i }));
    expect(upsertMutate).toHaveBeenCalledWith({ status: "watching", score: 0, progress: 1 });

    // The next-up card is unaired: pill yes, button no.
    useMyListEntry.mockReturnValue(entry(1));
    render(<EpisodeNavigator animeId={1} episodes={[ep(1), ep(2, "2999-01-01T00:00:00Z")]} episodesCount={2} />);
    const fresh = screen.getAllByRole("listitem").slice(-2);
    expect(fresh[1]).toHaveAttribute("data-state", "next");
    expect(within(fresh[1]).queryByRole("button", { name: /mark episode/i })).not.toBeInTheDocument();
  });

  it("puts friends on the episodes they're on", () => {
    useAnimeFriends.mockReturnValue({
      data: { data: [friend("kai", 2), friend("mia", 2), friend("sol", 2), friend("joy", 2), friend("ben", 3)], recommendations: [] },
    });
    render(<EpisodeNavigator animeId={1} episodes={episodes(3)} episodesCount={3} />);
    const cards = screen.getAllByRole("listitem");
    const two = within(cards[1]).getByLabelText(/kai, mia, sol and 1 more are here/i);
    expect(two).toBeInTheDocument();
    expect(within(two).getByText("+1")).toBeInTheDocument();
    expect(within(cards[2]).getByLabelText(/ben is here/i)).toBeInTheDocument();
    expect(within(cards[0]).queryByLabelText(/here/i)).not.toBeInTheDocument();
  });
});

describe("EpisodeNavigator — long runs", () => {
  beforeEach(() => {
    useMyListEntry.mockReturnValue({ data: null });
    useAnimeFriends.mockReturnValue({ data: undefined });
    push.mockReset();
  });

  it("pages a long show by fifties and opens on the viewer's range", () => {
    useMyListEntry.mockReturnValue(entry(73));
    render(<EpisodeNavigator animeId={1} episodes={episodes(120)} episodesCount={120} />);

    expect(screen.getByRole("button", { name: /episodes 51–100/i })).toBeInTheDocument();
    expect(screen.getByText("120 episodes")).toBeInTheDocument();
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(50);
    expect(cards[0]).toHaveAttribute("data-episode", "51");
    expect(screen.getByText("Up next")).toBeInTheDocument();
  });

  it("steps the range one page at a time", async () => {
    const user = userEvent.setup();
    render(<EpisodeNavigator animeId={1} episodes={episodes(120)} episodesCount={120} />);

    // No entry, nothing aired in the future: the rail opens on the last range.
    expect(screen.getByRole("button", { name: /episodes 101–150/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /later episodes/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /earlier episodes/i }));
    expect(screen.getByRole("button", { name: /episodes 51–100/i })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")[0]).toHaveAttribute("data-episode", "51");
  });

  it("leaves a short show unpaged", () => {
    render(<EpisodeNavigator animeId={1} episodes={episodes(12)} episodesCount={12} />);
    expect(screen.queryByRole("button", { name: /earlier episodes/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
  });
});
