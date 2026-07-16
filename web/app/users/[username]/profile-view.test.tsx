import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnimeSummary } from "@/lib/api/client";
import type { UserProfile } from "@/lib/profile";
import { ProfileView } from "./profile-view";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

vi.mock("@/lib/auth/session", () => ({ useSession: vi.fn() }));

const getMock = vi.fn();
const patchMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  browserApi: {
    GET: (...args: unknown[]) => getMock(...args),
    PATCH: (...args: unknown[]) => patchMock(...args),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useSession } from "@/lib/auth/session";

const mockSession = vi.mocked(useSession);

function anime(id: number, title: string, over: Partial<AnimeSummary> = {}): AnimeSummary {
  return {
    id,
    slug: `s-${id}`,
    title,
    title_english: null,
    cover_image: `c-${id}.jpg`,
    cover_color: "#336699",
    format: "TV",
    status: "FINISHED",
    season: "SPRING",
    season_year: 2024,
    episodes_count: 12,
    average_score: 82,
    popularity: 10,
    genres: ["Action"],
    next_airing_at: null,
    next_airing_episode: null,
    ...over,
  };
}

function stats(over: Partial<UserProfile["stats"]> = {}): UserProfile["stats"] {
  return {
    counts: { watching: 1, completed: 2, planning: 0, paused: 0, dropped: 0 },
    mean_score: 7.5,
    rated_count: 2,
    episodes_watched: 60,
    watch_minutes: 13_200,
    score_histogram: Array.from({ length: 10 }, (_, i) => ({
      score: i + 1,
      count: i + 1 === 8 ? 2 : 0,
    })),
    score_stddev: 1.9,
    score_bias: { user_mean: 6.8, community_mean: 8.1, sample_size: 7 },
    genres: [{ genre: "Action", count: 3, mean_score: 8.2, rated_count: 3 }],
    season_counts: [
      { year: 2019, count: 4 },
      { year: 2024, count: 1 },
    ],
    format_counts: [
      { format: "TV", count: 20 },
      { format: "MOVIE", count: 2 },
    ],
    top_studios: [{ name: "bones", count: 5 }],
    longest_completed: anime(7, "Long Runner", { episodes_count: 148 }),
    library_span: { earliest_year: 2007, latest_year: 2026 },
    ...over,
  };
}

const emptyStats: UserProfile["stats"] = {
  counts: { watching: 0, completed: 0, planning: 0, paused: 0, dropped: 0 },
  mean_score: null,
  rated_count: 0,
  episodes_watched: 0,
  watch_minutes: 0,
  score_histogram: Array.from({ length: 10 }, (_, i) => ({ score: i + 1, count: 0 })),
  score_stddev: null,
  score_bias: null,
  genres: [],
  season_counts: [],
  format_counts: [],
  top_studios: [],
  longest_completed: null,
  library_span: null,
};

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    username: "sam",
    avatar_url: null,
    bio: "sakuga appreciator",
    favorite_genres: ["Action"],
    role: "user",
    created_at: "2026-01-01T00:00:00Z",
    banner: { anime_id: 5, banner_image: "https://img.test/b.jpg", cover_color: "#e4a15d" },
    accent_color: null,
    stats: stats(),
    favorites: [anime(5, "Banner Show")],
    currently_watching: [{ anime: anime(9, "Weekly Show"), progress: 4 }],
    ...over,
  };
}

function mount(p: UserProfile, { authedAs = null }: { authedAs?: string | null } = {}) {
  mockSession.mockReturnValue({
    status: authedAs ? "authed" : "anon",
    user: authedAs ? { username: authedAs } : null,
  } as unknown as ReturnType<typeof useSession>);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProfileView profile={p} />
    </QueryClientProvider>,
  );
}

// Radix Tooltip's positioning needs ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  // Reduced motion across this suite: CountUp then leaves the true numbers in
  // the DOM instead of zeroing them for an IntersectionObserver jsdom lacks.
  // The animated path has its own test in count-up.test.tsx.
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  Element.prototype.scrollIntoView = vi.fn();
  getMock.mockReset();
  patchMock.mockReset();
  getMock.mockImplementation((url: string) => {
    if (url === "/users/{username}/follow") {
      return Promise.resolve({ data: { followers: 1, following: 2, is_following: false } });
    }
    if (url === "/users/{username}/list") {
      return Promise.resolve({ data: { data: [], total: 0, page: 1, per_page: 50 } });
    }
    return Promise.resolve({ data: {} });
  });
});

describe("ProfileView", () => {
  it("tints the page from the banner color and renders the stats", async () => {
    const { container } = mount(profile());
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--tint")).toBe("#e4a15d");
    expect(screen.getByText("9d 4h")).toBeInTheDocument();
    // The count numbers live in <strong> children; match the label text node.
    expect(await screen.findByText(/follower ·/)).toBeInTheDocument();
  });

  it("falls back to a favorite's color without a banner", () => {
    const { container } = mount(profile({ banner: null }));
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--tint")).toBe("#336699");
  });

  it("a histogram click filters the library to that score across all statuses", async () => {
    mount(profile());

    await userEvent.click(screen.getByRole("button", { name: /2 rated 8/ }));

    expect(screen.getByRole("tab", { name: /All/, selected: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Scored 8/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        "/users/{username}/list",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ status: undefined, score: 8 }),
          }),
        }),
      ),
    );
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("a genre bar click filters the library to that genre", async () => {
    mount(profile());

    await userEvent.click(screen.getByRole("button", { name: /3 Action shows/ }));

    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        "/users/{username}/list",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ genre: "Action" }),
          }),
        }),
      ),
    );
  });

  it("offers the banner picker to the owner only", () => {
    mount(profile(), { authedAs: "sam" });
    expect(screen.getByRole("button", { name: /Choose banner/ })).toBeInTheDocument();
  });

  it("hides owner affordances from visitors", () => {
    mount(profile());
    expect(screen.queryByRole("button", { name: /Choose banner/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Manage on My list/ })).not.toBeInTheDocument();
  });

  it("keeps a zero-list profile dressed", () => {
    mount(
      profile({
        banner: null,
        favorites: [],
        currently_watching: [],
        stats: emptyStats,
      }),
    );
    expect(screen.getByText(/no episodes logged yet/)).toBeInTheDocument();
    expect(screen.getByText(/hasn't logged any shows yet/)).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalledWith("/users/{username}/list", expect.anything());
  });

  it("shows no taste card, era strip, formats or habits on an empty shelf", () => {
    mount(profile({ banner: null, favorites: [], currently_watching: [], stats: emptyStats }));
    expect(screen.queryByText(/Score bias/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Eras$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Formats$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Habits$/i)).not.toBeInTheDocument();
  });

  it("names the critic and frames the watch time", () => {
    mount(profile());
    expect(screen.getByText("Harsh critic")).toBeInTheDocument();
    expect(screen.getByText(/−1\.30 vs the crowd, across 7 rated shows/)).toBeInTheDocument();
    expect(screen.getByText("Uses the whole scale")).toBeInTheDocument();
    // 13,200 min = 9d 4h = 2.5% of a year = 110 films
    expect(screen.getByText(/2\.5% of a year · 110 feature films/)).toBeInTheDocument();
  });

  it("an era click filters the library to completed shows of that year", async () => {
    mount(profile());

    await userEvent.click(screen.getByRole("button", { name: /4 completed from 2019/ }));

    expect(screen.getByRole("button", { name: /Premiered 2019/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        "/users/{username}/list",
        expect.objectContaining({
          params: expect.objectContaining({
            // The strip only ever counted completed shows, so the tab follows.
            query: expect.objectContaining({ year: 2019, status: "completed" }),
          }),
        }),
      ),
    );
  });

  it("zero-count era columns are inert", () => {
    mount(profile());
    expect(screen.getByRole("button", { name: /0 completed from 2020/ })).toBeDisabled();
  });

  it("a format segment click filters the library to that format", async () => {
    mount(profile());

    await userEvent.click(screen.getByRole("button", { name: /2 Movie — 9% of the library/ }));

    expect(screen.getByRole("button", { name: /^Movie/ })).toBeInTheDocument();
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        "/users/{username}/list",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ format: "MOVIE", status: undefined }),
          }),
        }),
      ),
    );
  });

  it("derives the habit tiles rather than printing zeroes", () => {
    mount(profile());
    // completed 2 / (completed 2 + dropped 0 + paused 0) = 100%
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("bones")).toBeInTheDocument();
    expect(screen.getByText("Long Runner")).toBeInTheDocument();
    // Drop rate is 0 here, so the tile stays away entirely.
    expect(screen.queryByText(/Drop rate/)).not.toBeInTheDocument();
  });

  it("suppresses a genre mean resting on too few ratings", () => {
    mount(profile({ stats: stats({ genres: [{ genre: "Action", count: 3, mean_score: 9, rated_count: 1 }] }) }));
    expect(
      screen.getByRole("button", { name: "3 Action shows — see them below" }),
    ).toBeInTheDocument();
  });

  it("prefers an explicit accent over the banner color", () => {
    const { container } = mount(profile({ accent_color: "#ff0000" }));
    expect((container.firstChild as HTMLElement).style.getPropertyValue("--tint")).toBe("#ff0000");
  });

  it("lets the owner recolor the page, and previews on hover before saving", async () => {
    patchMock.mockResolvedValue({ data: {} });
    const { container } = mount(profile(), { authedAs: "sam" });
    const root = container.firstChild as HTMLElement;

    await userEvent.click(screen.getByRole("button", { name: /Accent/ }));
    // The favorite's cover color leads the swatch row.
    const swatch = screen.getByRole("button", { name: "Accent #336699" });

    await userEvent.hover(swatch);
    expect(root.style.getPropertyValue("--tint")).toBe("#336699");

    await userEvent.click(swatch);
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/me/profile", {
        body: { accent_color: "#336699" },
      }),
    );
    expect(root.style.getPropertyValue("--tint")).toBe("#336699");
  });

  it("offers the owner a bio to write, and saves it in place", async () => {
    patchMock.mockResolvedValue({ data: {} });
    mount(profile({ bio: "" }), { authedAs: "sam" });

    await userEvent.click(screen.getByRole("button", { name: /Add a bio/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Bio" }), "Sakuga apologist.");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/me/profile", {
        body: { bio: "Sakuga apologist." },
      }),
    );
    expect(await screen.findByText("Sakuga apologist.")).toBeInTheDocument();
  });

  it("shows visitors a bio but never a way to edit it", () => {
    mount(profile());
    expect(screen.getByText("sakuga appreciator")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit bio/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Accent/ })).not.toBeInTheDocument();
  });

  it("tells the owner — and only the owner — where favorites come from", () => {
    mount(profile({ favorites: [] }), { authedAs: "sam" });
    expect(screen.getByText(/where your banner and accent color come from/)).toBeInTheDocument();
  });
});
