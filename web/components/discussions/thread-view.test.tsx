import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment } from "@/lib/hooks/use-thread-events";
import { ThreadView } from "./thread-view";

/** The empty room's be-first nudge — the "thread finished loading" sentinel. */
const EMPTY_ROOM = /Quiet in here so far/;

// ── Module mocks ────────────────────────────────────────────────────────────

const useSession = vi.fn<() => { status: string; user: { username: string } | null }>();
vi.mock("@/lib/auth/session", () => ({ useSession: () => useSession() }));

const apiGet = vi.fn();
vi.mock("@/lib/api/client", () => ({ browserApi: { GET: (...a: unknown[]) => apiGet(...a) } }));

// ── A controllable EventSource + observers jsdom doesn't ship ────────────────

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  private listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data?: unknown) {
    const ev = { data: data === undefined ? "" : JSON.stringify(data) };
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

// Reports the catch-up sentinel as off-screen, so live arrivals feed the pill
// instead of auto-scrolling (which is the more interesting path to assert).
class FakeIO {
  constructor(private cb: (entries: { isIntersecting: boolean }[]) => void) {}
  observe() {
    this.cb([{ isIntersecting: false }]);
  }
  disconnect() {}
}

function comment(id: number, body: string): Comment {
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
  };
}

function renderThread(props: Partial<ComponentProps<typeof ThreadView>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThreadView threadId={7} allowTimestamps {...props} />
    </QueryClientProvider>,
  );
  return FakeEventSource.instances.at(-1)!;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  useSession.mockReturnValue({ status: "anon", user: null });
  apiGet.mockResolvedValue({ data: { data: [] }, error: undefined });
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ThreadView live layer", () => {
  it("opens the SSE stream for the thread", async () => {
    const es = renderThread();
    await waitFor(() => expect(es).toBeTruthy());
    expect(es.url).toContain("/api/v1/threads/7/events");
  });

  it("shows the presence badge only at two or more readers", async () => {
    const es = renderThread();
    await screen.findByText(EMPTY_ROOM);

    expect(screen.queryByText(/here now/)).not.toBeInTheDocument();

    act(() => es.emit("presence", { count: 3 }));
    expect(await screen.findByText("3 here now")).toBeInTheDocument();

    act(() => es.emit("presence", { count: 1 }));
    await waitFor(() => expect(screen.queryByText(/here now/)).not.toBeInTheDocument());
  });

  it("appends a live comment and surfaces the 'N new' pill while scrolled up", async () => {
    const es = renderThread();
    await screen.findByText(EMPTY_ROOM);

    act(() => es.emit("comment.created", comment(1, "streamed in")));
    expect(await screen.findByText("streamed in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 new comment$/ })).toBeInTheDocument();

    act(() => es.emit("comment.created", comment(2, "another one")));
    expect(await screen.findByRole("button", { name: /2 new comments/ })).toBeInTheDocument();
  });

  it("marks live comments so they play the slide-in animation", async () => {
    const es = renderThread();
    await screen.findByText(EMPTY_ROOM);

    act(() => es.emit("comment.created", comment(1, "fresh")));
    const li = (await screen.findByText("fresh")).closest("li");
    expect(li).toHaveClass("comment-enter");
  });

  it("sorts newest-first by default, with Oldest and Top on demand", async () => {
    // The API returns pages newest-first (id-descending).
    apiGet.mockResolvedValue({
      data: {
        data: [
          comment(3, "third post"),
          { ...comment(2, "second post"), reactions: [{ emoji: "+1" as const, count: 3, mine: false }] },
          comment(1, "first post"),
        ],
      },
      error: undefined,
    });
    renderThread();
    await screen.findByText("first post");
    const bodies = () => screen.getAllByText(/post$/).map((e) => e.textContent);

    expect(bodies()).toEqual(["third post", "second post", "first post"]);

    fireEvent.click(screen.getByRole("button", { name: "Oldest" }));
    expect(bodies()).toEqual(["first post", "second post", "third post"]);

    // Top: most reactions first, zero-reaction ties fall back to newest.
    fireEvent.click(screen.getByRole("button", { name: "Top" }));
    expect(bodies()).toEqual(["second post", "third post", "first post"]);
  });

  it("shows a tappable quote of the parent on replies", async () => {
    const reply = { ...comment(3, "the reply"), parent_id: 1 };
    apiGet.mockResolvedValue({
      data: { data: [reply, comment(1, "root A")] }, // newest-first
      error: undefined,
    });
    renderThread();

    await screen.findByText("the reply");
    const chip = screen.getByRole("button", { name: "Jump to @user1's comment" });
    expect(chip).toHaveTextContent("root A");
  });

  it("renders a reply once, under its parent only", async () => {
    const reply = { ...comment(3, "the reply"), parent_id: 1 };
    apiGet.mockResolvedValue({
      data: { data: [reply, comment(2, "root B"), comment(1, "root A")] }, // newest-first
      error: undefined,
    });
    renderThread();

    await screen.findByText("the reply");
    const replies = screen.getAllByText("the reply");
    expect(replies).toHaveLength(1);

    // "root A" appears twice (the comment body + the reply's quote chip);
    // anchor on the body paragraph.
    const rootA = screen
      .getAllByText("root A")
      .find((e) => e.tagName === "P")!
      .closest("li")!;
    const rootB = screen.getByText("root B").closest("li")!;
    expect(rootA.contains(replies[0])).toBe(true);
    expect(rootB.contains(replies[0])).toBe(false);
  });

  it("tombstones a comment on comment.deleted", async () => {
    apiGet.mockResolvedValue({ data: { data: [comment(1, "here then gone")] }, error: undefined });
    const es = renderThread();
    await screen.findByText("here then gone");

    act(() => es.emit("comment.deleted", { comment_id: 1 }));
    expect(await screen.findByText("[removed]")).toBeInTheDocument();
  });

  it("loads older comments behind a Load older button (keyset paging)", async () => {
    apiGet.mockImplementation(
      (_path: string, opts: { params?: { query?: { before_id?: number } } }) => {
        // The older page is requested with before_id = the newest page's cursor.
        if (opts?.params?.query?.before_id === 10) {
          return Promise.resolve({
            data: { data: [comment(9, "older one")], next_cursor: null },
            error: undefined,
          });
        }
        return Promise.resolve({
          data: {
            data: [comment(12, "newest"), comment(11, "middle"), comment(10, "boundary")],
            next_cursor: 10,
          },
          error: undefined,
        });
      },
    );
    renderThread();

    await screen.findByText("newest");
    // Older page isn't loaded yet; the honest scope note is shown.
    expect(screen.queryByText("older one")).not.toBeInTheDocument();
    expect(screen.getByText(/Showing the 3 most recent/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load older comments" }));
    expect(await screen.findByText("older one")).toBeInTheDocument();
    // Reached the oldest comment: no more paging, note gone.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Load older comments" })).not.toBeInTheDocument(),
    );
  });

  it("keeps a reply whose parent is on an unloaded older page visible, with a stub", async () => {
    // Reply to comment 2, which isn't in the loaded (newest) page.
    const orphan = { ...comment(10, "orphan reply"), parent_id: 2 };
    apiGet.mockResolvedValue({
      data: { data: [comment(12, "root here"), orphan], next_cursor: 5 }, // newest-first
      error: undefined,
    });
    renderThread();

    // The orphan is promoted to a display root instead of vanishing, and marked.
    expect(await screen.findByText("orphan reply")).toBeInTheDocument();
    expect(screen.getByText("earlier comment")).toBeInTheDocument();
  });

  it("dresses an upcoming episode's empty room with a ticking countdown", async () => {
    const airingAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    renderThread({ upcoming: true, airingAt });

    expect(await screen.findByText(/^Airs in/)).toBeInTheDocument();
    expect(screen.getByText(/open early/)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_ROOM)).not.toBeInTheDocument();
  });

  it("shows who's in the empty room", async () => {
    const es = renderThread();
    await screen.findByText(EMPTY_ROOM);

    act(() => es.emit("presence", { count: 3 }));
    expect(await screen.findByText("3 in the room right now")).toBeInTheDocument();
  });

  it("shows comment velocity in the live window only", async () => {
    const recent = (id: number, minutesAgo: number) => ({
      ...comment(id, `speed ${id}`),
      created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    });
    apiGet.mockResolvedValue({
      data: { data: [recent(3, 1), recent(2, 2), recent(1, 5)] },
      error: undefined,
    });

    renderThread({ live: true });
    // 3 comments in the 15-minute window → 0.2/min.
    expect(await screen.findByText("0.2/min")).toBeInTheDocument();
  });

  it("keeps the velocity chip out of threads past their live window", async () => {
    const recent = (id: number) => ({
      ...comment(id, `speed ${id}`),
      created_at: new Date(Date.now() - id * 60_000).toISOString(),
    });
    apiGet.mockResolvedValue({
      data: { data: [recent(3), recent(2), recent(1)] },
      error: undefined,
    });

    renderThread();
    await screen.findByText("speed 1");
    expect(screen.queryByText(/\/min/)).not.toBeInTheDocument();
  });

  it("renders the density strip for timestamped threads, jumping on cluster click", async () => {
    apiGet.mockResolvedValue({
      data: {
        data: [
          { ...comment(2, "late scene"), timestamp_seconds: 700 },
          { ...comment(1, "cold open"), timestamp_seconds: 15 },
        ],
      },
      error: undefined,
    });

    renderThread();
    const strip = await screen.findByRole("region", { name: /where the discussion lands/i });
    expect(strip).toHaveTextContent("2 anchored comments");
    expect(strip).toHaveTextContent("11:40"); // 700 s — the axis' right edge

    fireEvent.click(screen.getByRole("button", { name: /jump to 1 comment around 0:15/i }));
    // jumpToComment scrolls after a double rAF; the flash lands on the li.
    await waitFor(() =>
      expect(document.getElementById("comment-1")?.classList.contains("comment-flash")).toBe(true),
    );
  });

  it("keeps the strip off series boards (no timestamps there)", async () => {
    apiGet.mockResolvedValue({
      data: { data: [{ ...comment(1, "series talk"), timestamp_seconds: 60 }] },
      error: undefined,
    });

    renderThread({ allowTimestamps: false });
    await screen.findByText("series talk");
    expect(screen.queryByRole("region", { name: /where the discussion lands/i })).not.toBeInTheDocument();
  });

  it("closes the stream on unmount", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <ThreadView threadId={7} allowTimestamps />
      </QueryClientProvider>,
    );
    const es = FakeEventSource.instances.at(-1)!;
    unmount();
    expect(es.closed).toBe(true);
  });
});
