import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment } from "@/lib/hooks/use-thread-events";
import { ThreadView } from "./thread-view";

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

// Reports the bottom sentinel as off-screen, so live arrivals feed the pill
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

function renderThread() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThreadView threadId={7} allowTimestamps />
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
    await screen.findByText("No comments yet — first!");

    expect(screen.queryByText(/here now/)).not.toBeInTheDocument();

    act(() => es.emit("presence", { count: 3 }));
    expect(await screen.findByText("3 here now")).toBeInTheDocument();

    act(() => es.emit("presence", { count: 1 }));
    await waitFor(() => expect(screen.queryByText(/here now/)).not.toBeInTheDocument());
  });

  it("appends a live comment and surfaces the 'N new' pill while scrolled up", async () => {
    const es = renderThread();
    await screen.findByText("No comments yet — first!");

    act(() => es.emit("comment.created", comment(1, "streamed in")));
    expect(await screen.findByText("streamed in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /1 new comment$/ })).toBeInTheDocument();

    act(() => es.emit("comment.created", comment(2, "another one")));
    expect(await screen.findByRole("button", { name: /2 new comments/ })).toBeInTheDocument();
  });

  it("marks live comments so they play the slide-in animation", async () => {
    const es = renderThread();
    await screen.findByText("No comments yet — first!");

    act(() => es.emit("comment.created", comment(1, "fresh")));
    const li = (await screen.findByText("fresh")).closest("li");
    expect(li).toHaveClass("comment-enter");
  });

  it("tombstones a comment on comment.deleted", async () => {
    apiGet.mockResolvedValue({ data: { data: [comment(1, "here then gone")] }, error: undefined });
    const es = renderThread();
    await screen.findByText("here then gone");

    act(() => es.emit("comment.deleted", { comment_id: 1 }));
    expect(await screen.findByText("[removed]")).toBeInTheDocument();
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
