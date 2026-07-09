import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnimeSummary } from "@/lib/api/client";
import { Onboarding } from "./onboarding";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

vi.mock("@/lib/auth/session", () => ({ useSession: vi.fn() }));

// Identity debounce so a typed query resolves synchronously in tests.
vi.mock("@/lib/hooks/use-debounced", () => ({ useDebounced: (v: string) => v }));

const putMock = vi.fn();
const getMock = vi.fn();
vi.mock("@/lib/api/client", () => ({
  browserApi: {
    PUT: (...args: unknown[]) => putMock(...args),
    GET: (...args: unknown[]) => getMock(...args),
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { useSession } from "@/lib/auth/session";

const mockSession = vi.mocked(useSession);

function anime(id: number, title: string): AnimeSummary {
  return {
    id,
    slug: `s-${id}`,
    title,
    title_english: null,
    cover_image: `c-${id}.jpg`,
    cover_color: null,
    format: "TV",
    status: "RELEASING",
    season: "SUMMER",
    season_year: 2026,
    episodes_count: 12,
    average_score: 80,
    popularity: 1,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
  };
}

function mount(
  seasonal: AnimeSummary[],
  popular: AnimeSummary[] = [],
  status = "authed",
) {
  mockSession.mockReturnValue({
    status,
    user: { username: "newbie" },
  } as unknown as ReturnType<typeof useSession>);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Onboarding seasonal={seasonal} popular={popular} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe("Onboarding", () => {
  it("toggles picks and reflects the count in the finish button", async () => {
    const user = userEvent.setup();
    mount([anime(1, "Alpha"), anime(2, "Beta")]);

    expect(screen.getByRole("button", { name: "Add shows" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(screen.getByRole("button", { name: /Alpha/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Add 1 & finish" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /Beta/ }));
    expect(screen.getByRole("button", { name: "Add 2 & finish" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Beta/ }));
    expect(screen.getByRole("button", { name: "Add 1 & finish" })).toBeInTheDocument();
  });

  it("switches between the airing-now and all-time-popular pools", async () => {
    const user = userEvent.setup();
    mount([anime(1, "Seasonal Show")], [anime(9, "Classic Show")]);

    expect(screen.getByRole("button", { name: /Seasonal Show/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Classic Show/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All-time popular" }));
    expect(screen.getByRole("button", { name: /Classic Show/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Seasonal Show/ })).not.toBeInTheDocument();
  });

  it("searches the catalog and keeps a search pick when the query is cleared", async () => {
    getMock.mockResolvedValue({ data: { data: [anime(42, "Old Favorite")] }, error: undefined });
    const user = userEvent.setup();
    mount([anime(1, "Seasonal Show")]);

    const box = screen.getByRole("searchbox", { name: /Search the catalog/ });
    await user.type(box, "old");
    expect(await screen.findByRole("button", { name: /Old Favorite/ })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/anime", { params: { query: { q: "old" } } });

    await user.click(screen.getByRole("button", { name: /Old Favorite/ }));
    expect(screen.getByRole("button", { name: "Add 1 & finish" })).toBeInTheDocument();

    // Clearing search returns to the seasonal grid, but the pick is still counted.
    await user.clear(box);
    expect(screen.getByRole("button", { name: /Seasonal Show/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 1 & finish" })).toBeInTheDocument();
  });

  it("writes each picked show as watching, then navigates home", async () => {
    putMock.mockResolvedValue({ error: undefined });
    const user = userEvent.setup();
    mount([anime(1, "Alpha"), anime(2, "Beta")]);

    await user.click(screen.getByRole("button", { name: /Alpha/ }));
    await user.click(screen.getByRole("button", { name: /Beta/ }));
    await user.click(screen.getByRole("button", { name: "Add 2 & finish" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(putMock).toHaveBeenCalledTimes(2);
    expect(putMock).toHaveBeenCalledWith("/me/list/{animeId}", {
      params: { path: { animeId: 1 } },
      body: { status: "watching" },
    });
    expect(putMock).toHaveBeenCalledWith("/me/list/{animeId}", {
      params: { path: { animeId: 2 } },
      body: { status: "watching" },
    });
  });

  it("skips straight home without writing anything", async () => {
    const user = userEvent.setup();
    mount([anime(1, "Alpha")]);
    // With nothing picked the skip reads as the not-watching path.
    await user.click(screen.getByRole("button", { name: "Not watching anything yet" }));
    expect(push).toHaveBeenCalledWith("/");
    expect(putMock).not.toHaveBeenCalled();
  });

  it("prompts to sign in when the session resolved to anon", () => {
    mount([anime(1, "Alpha")], [], "anon");
    expect(screen.getByText(/signed out/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: /Alpha/ })).not.toBeInTheDocument();
  });
});
