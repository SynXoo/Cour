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

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    username: "sam",
    avatar_url: null,
    bio: "sakuga appreciator",
    favorite_genres: ["Action"],
    role: "user",
    created_at: "2026-01-01T00:00:00Z",
    banner: { anime_id: 5, banner_image: "https://img.test/b.jpg", cover_color: "#e4a15d" },
    stats: {
      counts: { watching: 1, completed: 2, planning: 0, paused: 0, dropped: 0 },
      mean_score: 7.5,
      rated_count: 2,
      episodes_watched: 60,
      watch_minutes: 13_200,
      score_histogram: Array.from({ length: 10 }, (_, i) => ({
        score: i + 1,
        count: i + 1 === 8 ? 2 : 0,
      })),
      genres: [{ genre: "Action", count: 3 }],
    },
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
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
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
        stats: {
          counts: { watching: 0, completed: 0, planning: 0, paused: 0, dropped: 0 },
          mean_score: null,
          rated_count: 0,
          episodes_watched: 0,
          watch_minutes: 0,
          score_histogram: Array.from({ length: 10 }, (_, i) => ({ score: i + 1, count: 0 })),
          genres: [],
        },
      }),
    );
    expect(screen.getByText(/no episodes logged yet/)).toBeInTheDocument();
    expect(screen.getByText(/hasn't logged any shows yet/)).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalledWith("/users/{username}/list", expect.anything());
  });
});
