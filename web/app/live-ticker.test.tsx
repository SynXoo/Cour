import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TickerItem } from "@/lib/landing";
import { LiveTicker } from "./live-ticker";

function item(id: number): TickerItem {
  return {
    id,
    username: `user${id}`,
    avatarUrl: null,
    body: `comment ${id}`,
    ago: "2m ago",
    animeTitle: "Some Show",
    episode: 3,
    href: "/anime/1/episode/3",
  };
}

const items = (n: number) => Array.from({ length: n }, (_, i) => item(i + 1));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LiveTicker", () => {
  it("renders comment rows as thread links", () => {
    render(<LiveTicker items={items(2)} />);
    expect(screen.getByText("comment 1")).toBeInTheDocument();
    expect(screen.getByText("comment 2")).toBeInTheDocument();
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/anime/1/episode/3");
  });

  it("rotates the visible window when there are more items than rows", () => {
    render(<LiveTicker items={items(5)} />);
    expect(screen.getByText("comment 1")).toBeInTheDocument();
    expect(screen.queryByText("comment 4")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("comment 1")).not.toBeInTheDocument();
    expect(screen.getByText("comment 4")).toBeInTheDocument();
  });

  it("does not rotate a feed that already fits", () => {
    render(<LiveTicker items={items(3)} />);
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByText("comment 1")).toBeInTheDocument();
  });

  it("stands still under prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<LiveTicker items={items(5)} />);
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByText("comment 1")).toBeInTheDocument();
  });

  it("pauses while the pointer is over the list", () => {
    render(<LiveTicker items={items(5)} />);
    fireEvent.mouseEnter(screen.getByRole("list"));
    act(() => vi.advanceTimersByTime(20_000));
    expect(screen.getByText("comment 1")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("list"));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText("comment 1")).not.toBeInTheDocument();
  });
});
