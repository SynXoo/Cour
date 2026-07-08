import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommentItem, CommentsIndexContext, type Comment } from "./comment-item";
import { EpisodeSpoilerShield } from "./episode-spoiler-shield";

// ── Module mocks ────────────────────────────────────────────────────────────

const useSession = vi.fn<() => { status: string; user: { username: string } | null }>();
vi.mock("@/lib/auth/session", () => ({ useSession: () => useSession() }));

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock("@/lib/api/client", () => ({
  browserApi: {
    GET: (...a: unknown[]) => apiGet(...a),
    PUT: (...a: unknown[]) => apiPut(...a),
    DELETE: vi.fn(),
  },
}));

type Entry = {
  anime_id: number;
  status: string;
  score: number | null;
  progress: number;
  started_on: string | null;
  finished_on: string | null;
  updated_at: string;
};

function entry(progress: number, status = "watching"): Entry {
  return {
    anime_id: 5,
    status,
    score: null,
    progress,
    started_on: null,
    finished_on: null,
    updated_at: "2026-07-07T00:00:00Z",
  };
}

const AIRED = "2026-07-01T12:00:00Z"; // safely in the past
const FUTURE = "2099-01-01T12:00:00Z";

function comment(id: number, body: string, extra: Partial<Comment> = {}): Comment {
  return {
    id,
    thread_id: 7,
    parent_id: null,
    author: { username: `user${id}`, avatar_url: null },
    body,
    timestamp_seconds: null,
    has_spoilers: false,
    deleted: false,
    reactions: [],
    created_at: "2026-07-07T00:00:00Z",
    ...extra,
  };
}

function renderShield(
  listEntry: Entry | null,
  { airingAt = AIRED, aired = true }: { airingAt?: string | null; aired?: boolean } = {},
) {
  apiGet.mockResolvedValue(
    listEntry
      ? { data: listEntry, error: undefined, response: { status: 200 } }
      : { data: undefined, error: { error: { message: "not found" } }, response: { status: 404 } },
  );

  // A root comment plus a reply quoting it, to assert the shield covers both
  // the body (blur) and the quote chip (placeholder).
  const root = comment(1, "the twist: everyone was a fish");
  const reply = comment(2, "called it", { parent_id: 1 });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <EpisodeSpoilerShield animeId={5} episodeNumber={9} airingAt={airingAt} aired={aired}>
        <CommentsIndexContext.Provider value={new Map([[1, root]])}>
          <ul>
            <CommentItem comment={root} replies={[]} onReply={() => {}} />
            <CommentItem comment={reply} replies={[]} onReply={() => {}} />
          </ul>
        </CommentsIndexContext.Provider>
      </EpisodeSpoilerShield>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useSession.mockReturnValue({ status: "authed", user: { username: "viewer" } });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("EpisodeSpoilerShield", () => {
  it("banners and blurs everything for a viewer episodes behind", async () => {
    renderShield(entry(3));

    expect(await screen.findByText(/6 episodes behind \(on episode 3\)/)).toBeInTheDocument();
    // Both comment bodies sit behind spoiler guards…
    expect(screen.getAllByTestId("spoiler-guard")).toHaveLength(2);
    // …and the reply's quote chip hides the parent excerpt.
    expect(screen.getByText("hidden comment")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark ep/ })).not.toBeInTheDocument();
  });

  it("reveal-all is a toggle", async () => {
    renderShield(entry(3));
    fireEvent.click(await screen.findByRole("button", { name: "Show anyway" }));

    await waitFor(() => expect(screen.queryAllByTestId("spoiler-guard")).toHaveLength(0));
    // Body <p> and the now-unhidden quote chip both carry the text.
    expect(screen.getAllByText("the twist: everyone was a fish")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Blur again" }));
    expect(screen.getAllByTestId("spoiler-guard")).toHaveLength(2);
  });

  it("offers mark-watched on the viewer's next episode and clears on success", async () => {
    apiPut.mockResolvedValue({ data: entry(9), error: undefined, response: { status: 200 } });
    renderShield(entry(8));

    expect(await screen.findByText(/haven't watched this episode yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark ep 9 watched" }));

    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith("/me/list/{animeId}", {
        params: { path: { animeId: 5 } },
        body: { status: "watching", progress: 9 },
      }),
    );
    // The upsert response lands in the entry cache → no longer behind.
    await waitFor(() => expect(screen.queryByText(/comments are blurred/)).not.toBeInTheDocument());
    expect(screen.queryAllByTestId("spoiler-guard")).toHaveLength(0);
  });

  it("never guards completed entries, missing entries, or anonymous viewers", async () => {
    renderShield(entry(0, "completed"));
    await waitFor(() => expect(screen.queryAllByTestId("spoiler-guard")).toHaveLength(0));
    expect(screen.queryByText(/behind/)).not.toBeInTheDocument();
  });

  it("skips unaired episodes — the speculation banner owns those", async () => {
    renderShield(entry(3), { airingAt: FUTURE, aired: false });
    await waitFor(() => expect(screen.queryAllByTestId("spoiler-guard")).toHaveLength(0));
    expect(screen.queryByText(/behind/)).not.toBeInTheDocument();
  });

  it("badges comments posted within 24h of airing", async () => {
    renderShield(null, { airingAt: "2026-07-07T00:00:00Z" }); // comments post at +0h
    await waitFor(() => expect(screen.getAllByText("night of")).toHaveLength(2));
  });
});
