import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Comment } from "@/lib/hooks/use-thread-events";
import { TimestampDensity } from "./timestamp-density";

// The strip only pulls jumpToComment (and types) from comment-item; a full
// mock keeps the session/api machinery out of this test.
const jumpToComment = vi.fn();
vi.mock("./comment-item", () => ({ jumpToComment: (id: number) => jumpToComment(id) }));

function comment(id: number, timestamp_seconds: number | null, deleted = false): Comment {
  return {
    id,
    thread_id: 7,
    parent_id: null,
    author: { username: `user${id}`, avatar_url: null },
    body: `comment ${id}`,
    timestamp_seconds,
    has_spoilers: false,
    deleted,
    reactions: [],
    created_at: "2026-07-09T00:00:00Z",
  };
}

afterEach(() => vi.clearAllMocks());

describe("TimestampDensity", () => {
  it("renders nothing without timestamped comments", () => {
    const { container } = render(
      <TimestampDensity comments={[comment(1, null), comment(2, 30, true)]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("draws the axis from 0:00 to the last stamp with a bar per bucket", () => {
    render(<TimestampDensity comments={[comment(1, 10), comment(2, 754)]} />);
    const strip = screen.getByRole("region", { name: /where the discussion lands/i });
    expect(strip).toHaveTextContent("Episode timeline");
    expect(strip).toHaveTextContent("2 anchored comments");
    expect(strip).toHaveTextContent("0:00");
    expect(strip).toHaveTextContent("12:34"); // 754 s — the right edge label
  });

  it("jumps the list to a cluster's earliest comment on click", () => {
    // 5 s and 10 s share the first cluster (bucket width ~19 s); 700 s is its own.
    render(
      <TimestampDensity comments={[comment(3, 10), comment(1, 5), comment(2, 700)]} />,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName(/jump to 2 comments around 0:05/i);

    fireEvent.click(buttons[0]);
    expect(jumpToComment).toHaveBeenCalledWith(1);
  });
});
