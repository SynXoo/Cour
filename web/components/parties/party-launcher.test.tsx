import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchPartySummary } from "@/lib/hooks/use-parties";
import { PartyLauncher } from "./party-launcher";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

let status: "loading" | "authed" | "anon" = "authed";
vi.mock("@/lib/auth/session", () => ({ useSession: () => ({ status, user: null }) }));

let flag = true;
vi.mock("@/lib/hooks/use-features", () => ({
  useFeatures: () => ({ data: { watch_parties: flag } }),
}));

const rooms: WatchPartySummary[] = [];
const mutateAsync = vi.fn(async () => ({ id: 42 }));
vi.mock("@/lib/hooks/use-parties", () => ({
  useOpenParties: () => ({ data: rooms }),
  useCreateParty: () => ({ mutateAsync, isPending: false }),
}));

const room = (id: number, username: string, watching: number, visibility = "public"): WatchPartySummary =>
  ({
    id,
    anime: { id: 1, slug: "s", title: "Show", title_english: null },
    episode: { number: 3, title: null, airing_at: null },
    host: { username, avatar_url: null },
    visibility,
    created_at: "",
    closed_at: null,
    watching,
  }) as unknown as WatchPartySummary;

beforeEach(() => {
  status = "authed";
  flag = true;
  rooms.length = 0;
  push.mockClear();
  mutateAsync.mockClear();
});

describe("PartyLauncher", () => {
  it("renders nothing while the feature is off", () => {
    flag = false;
    const { container } = render(<PartyLauncher animeId={1} episode={3} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("starts a followers party by default and navigates to it", async () => {
    render(<PartyLauncher animeId={1} episode={3} />);
    expect(screen.getByText(/everyone brings their own stream/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start a party" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/parties/42"));
    expect(mutateAsync).toHaveBeenCalledWith({ animeId: 1, episode: 3, visibility: "followers" });
  });

  it("lists the open rooms for this episode with join links", () => {
    rooms.push(room(7, "rin", 4), room(8, "sue", 0, "invite"));
    render(<PartyLauncher animeId={1} episode={3} />);
    expect(screen.getByText(/2 rooms are watching this episode/)).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Open rooms for this episode" });
    const links = list.querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual(["/parties/7", "/parties/8"]);
    expect(screen.getByText("4 watching · Join →")).toBeInTheDocument();
    expect(screen.getByText("invite")).toBeInTheDocument();
  });

  it("nudges anonymous viewers to sign in instead of showing the launcher", () => {
    status = "anon";
    rooms.push(room(7, "rin", 1));
    render(<PartyLauncher animeId={1} episode={3} />);
    expect(screen.getByRole("link", { name: "Sign in to start one" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "Start a party" })).not.toBeInTheDocument();
    expect(screen.getByText(/1 room is watching/)).toBeInTheDocument();
  });
});
