import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Episode } from "@/lib/episodes";
import type { FriendOnAnime } from "@/lib/social";
import { EpisodeList } from "./episode-list";

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

const ep = (number: number, airing_at: string | null = "2026-01-01T00:00:00Z"): Episode => ({
  number,
  title: null,
  airing_at,
});
const episodes = (n: number) => Array.from({ length: n }, (_, i) => ep(i + 1));

const friend = (username: string, progress: number): FriendOnAnime => ({
  user: { username, avatar_url: null },
  status: "watching",
  progress,
  score: null,
});

describe("EpisodeList — you are here", () => {
  beforeEach(() => {
    useMyListEntry.mockReturnValue({ data: null });
    useAnimeFriends.mockReturnValue({ data: undefined });
    upsertMutate.mockReset();
  });

  it("renders plain rows without a list entry", () => {
    render(<EpisodeList animeId={1} episodes={episodes(3)} episodesCount={3} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByText(/up next/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /watched/i })).not.toBeInTheDocument();
  });

  it("ticks watched rows, marks the next one, and advances on Watched", async () => {
    useMyListEntry.mockReturnValue({
      data: { anime_id: 1, status: "watching", score: 8, progress: 2, started_on: null, finished_on: null, updated_at: "" },
    });
    const user = userEvent.setup();
    render(<EpisodeList animeId={1} episodes={episodes(4)} episodesCount={4} />);

    expect(screen.getByText("You're on episode 2 of 4 · 2 to go")).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("data-state", "watched");
    expect(rows[1]).toHaveAttribute("data-state", "watched");
    expect(rows[2]).toHaveAttribute("data-state", "next");
    expect(rows[3]).toHaveAttribute("data-state", "ahead");
    expect(within(rows[2]).getByText("Up next")).toBeInTheDocument();

    await user.click(within(rows[2]).getByRole("button", { name: /watched/i }));
    expect(upsertMutate).toHaveBeenCalledWith({ status: "watching", score: 8, progress: 3 });
  });

  it("moves a planning entry to watching on the first tick and keeps the pill on an unaired next episode", async () => {
    useMyListEntry.mockReturnValue({
      data: { anime_id: 1, status: "planning", score: null, progress: 0, started_on: null, finished_on: null, updated_at: "" },
    });
    const user = userEvent.setup();
    render(<EpisodeList animeId={1} episodes={[ep(1), ep(2, "2999-01-01T00:00:00Z")]} episodesCount={2} />);
    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveAttribute("data-state", "next");
    await user.click(within(rows[0]).getByRole("button", { name: /watched/i }));
    expect(upsertMutate).toHaveBeenCalledWith({ status: "watching", score: 0, progress: 1 });

    // The next-up row is unaired: pill yes, button no.
    useMyListEntry.mockReturnValue({
      data: { anime_id: 1, status: "watching", score: null, progress: 1, started_on: null, finished_on: null, updated_at: "" },
    });
    render(<EpisodeList animeId={1} episodes={[ep(1), ep(2, "2999-01-01T00:00:00Z")]} episodesCount={2} />);
    const fresh = screen.getAllByRole("listitem").slice(-2);
    expect(fresh[1]).toHaveAttribute("data-state", "next");
    expect(within(fresh[1]).queryByRole("button", { name: /watched/i })).not.toBeInTheDocument();
  });

  it("puts friends on the rows they're on", () => {
    useMyListEntry.mockReturnValue({ data: null });
    useAnimeFriends.mockReturnValue({
      data: { data: [friend("kai", 2), friend("mia", 2), friend("sol", 2), friend("joy", 2), friend("ben", 3)], recommendations: [] },
    });
    render(<EpisodeList animeId={1} episodes={episodes(3)} episodesCount={3} />);
    const rows = screen.getAllByRole("listitem");
    const two = within(rows[1]).getByLabelText(/kai, mia, sol and 1 more are here/i);
    expect(two).toBeInTheDocument();
    expect(within(two).getByText("+1")).toBeInTheDocument();
    expect(within(rows[2]).getByLabelText(/ben is here/i)).toBeInTheDocument();
    expect(within(rows[0]).queryByLabelText(/here/i)).not.toBeInTheDocument();
  });

  it("opens a long show on the viewer's range", () => {
    useMyListEntry.mockReturnValue({
      data: { anime_id: 1, status: "watching", score: null, progress: 73, started_on: null, finished_on: null, updated_at: "" },
    });
    render(<EpisodeList animeId={1} episodes={episodes(120)} episodesCount={120} />);
    expect(screen.getByRole("button", { name: "51–100" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Up next")).toBeInTheDocument();
  });
});
