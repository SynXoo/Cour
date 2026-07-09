import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListEntryWithAnime } from "@/lib/profile";
import { LibrarySection } from "./library-section";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

vi.mock("@/lib/auth/session", () => ({ useSession: vi.fn() }));

const getMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  browserApi: { GET: (...args: unknown[]) => getMock(...args) },
}));

import { useSession } from "@/lib/auth/session";

const mockSession = vi.mocked(useSession);

function entry(id: number, title: string, over: Partial<ListEntryWithAnime> = {}): ListEntryWithAnime {
  return {
    anime_id: id,
    status: "completed",
    score: 8,
    progress: 12,
    started_on: null,
    finished_on: null,
    updated_at: "2026-07-01T00:00:00Z",
    anime: {
      id,
      slug: `s-${id}`,
      title,
      title_english: null,
      cover_image: `c-${id}.jpg`,
      cover_color: null,
      format: "TV",
      status: "FINISHED",
      season: "SPRING",
      season_year: 2024,
      episodes_count: 12,
      average_score: 80,
      popularity: 10,
      genres: ["Action"],
      next_airing_at: null,
      next_airing_episode: null,
    },
    ...over,
  };
}

const counts = { watching: 1, completed: 60, planning: 0, paused: 0, dropped: 0 };

beforeEach(() => {
  getMock.mockReset();
});

function mount(
  props: Partial<Parameters<typeof LibrarySection>[0]> = {},
  { authedAs = null }: { authedAs?: string | null } = {},
) {
  mockSession.mockReturnValue({
    status: authedAs ? "authed" : "anon",
    user: authedAs ? { username: authedAs } : null,
  } as unknown as ReturnType<typeof useSession>);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFilterChange = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <LibrarySection
        username="sam"
        counts={counts}
        filter={{ status: "completed", score: null, genre: null }}
        onFilterChange={onFilterChange}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onFilterChange };
}

describe("LibrarySection", () => {
  it("fetches the active tab's page and pages on through Show more", async () => {
    getMock.mockImplementation((_url, opts) => {
      const { page } = (opts as { params: { query: { page: number } } }).params.query;
      const data =
        page === 1
          ? Array.from({ length: 50 }, (_, i) => entry(i + 1, `Show ${i + 1}`))
          : Array.from({ length: 10 }, (_, i) => entry(50 + i + 1, `Show ${50 + i + 1}`));
      return Promise.resolve({ data: { data, total: 60, page, per_page: 50 } });
    });

    mount();

    expect(await screen.findByText("Show 1")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(
      "/users/{username}/list",
      expect.objectContaining({
        params: expect.objectContaining({
          query: expect.objectContaining({ status: "completed", page: 1, per_page: 50 }),
        }),
      }),
    );
    expect(screen.getByText("50 of 60")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(await screen.findByText("Show 60")).toBeInTheDocument();
    expect(screen.getByText("60 of 60")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show more" })).not.toBeInTheDocument();
  });

  it("switching tabs reports the new status instead of fetching in place", async () => {
    getMock.mockResolvedValue({ data: { data: [entry(1, "Solo")], total: 1, page: 1, per_page: 50 } });
    const { onFilterChange } = mount();
    await screen.findByText("Solo");

    await userEvent.click(screen.getByRole("tab", { name: /Watching/ }));
    expect(onFilterChange).toHaveBeenCalledWith({ status: "watching", score: null, genre: null });
  });

  it("sends active score/genre filters and clears them from the chips", async () => {
    getMock.mockResolvedValue({ data: { data: [], total: 0, page: 1, per_page: 50 } });
    const { onFilterChange } = mount({ filter: { status: "all", score: 7, genre: "Action" } });

    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        "/users/{username}/list",
        expect.objectContaining({
          params: expect.objectContaining({
            query: expect.objectContaining({ status: undefined, score: 7, genre: "Action" }),
          }),
        }),
      ),
    );
    expect(await screen.findByText(/Nothing here matches the filter/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Scored 7/ }));
    expect(onFilterChange).toHaveBeenCalledWith({ status: "all", score: null, genre: "Action" });
  });

  it("dresses an empty library and keeps the owner shortcut for owners only", () => {
    mount({ counts: { watching: 0, completed: 0, planning: 0, paused: 0, dropped: 0 } });
    expect(screen.getByText(/hasn't logged any shows yet/)).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
  });

  it("shows the manage shortcut to the owner", async () => {
    getMock.mockResolvedValue({ data: { data: [entry(1, "Solo")], total: 1, page: 1, per_page: 50 } });
    mount({}, { authedAs: "sam" });
    expect(await screen.findByRole("link", { name: /Manage on My list/ })).toHaveAttribute(
      "href",
      "/list",
    );
  });
});
