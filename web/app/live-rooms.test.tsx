import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRoom } from "@/lib/landing";
import { LiveRooms } from "./live-rooms";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt } = props as { src: string; alt: string };
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} />;
  },
}));

function room(id: number, over: Partial<LiveRoom> = {}): LiveRoom {
  return {
    threadId: id,
    title: `Show ${id}`,
    cover: `cover-${id}.jpg`,
    label: `Ep ${id} room`,
    commentCount: 10 + id,
    recent: 2,
    presence: 0,
    ago: "2m ago",
    href: `/anime/${id}/episode/${id}`,
    ...over,
  };
}

const rooms = (n: number) => Array.from({ length: n }, (_, i) => room(i + 1));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("LiveRooms", () => {
  it("renders room rows as thread links with stats, never comment text", () => {
    render(<LiveRooms rooms={rooms(2).map((r, i) => (i === 0 ? { ...r, presence: 3 } : r))} />);
    expect(screen.getByText("Show 1")).toBeInTheDocument();
    expect(screen.getByText(/Ep 1 room · 11 comments/)).toBeInTheDocument();
    expect(screen.getByText(/3 in there/)).toBeInTheDocument();
    expect(screen.getAllByRole("link")[0]).toHaveAttribute("href", "/anime/1/episode/1");
  });

  it("rotates the window when there are more rooms than slots", () => {
    render(<LiveRooms rooms={rooms(6)} />);
    expect(screen.getByText("Show 1")).toBeInTheDocument();
    expect(screen.queryByText("Show 5")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Show 1")).not.toBeInTheDocument();
    expect(screen.getByText("Show 5")).toBeInTheDocument();
  });

  it("does not rotate a panel that already fits", () => {
    render(<LiveRooms rooms={rooms(4)} />);
    act(() => vi.advanceTimersByTime(25_000));
    expect(screen.getByText("Show 1")).toBeInTheDocument();
  });

  it("stands still under prefers-reduced-motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<LiveRooms rooms={rooms(6)} />);
    act(() => vi.advanceTimersByTime(25_000));
    expect(screen.getByText("Show 1")).toBeInTheDocument();
  });

  it("pauses while the pointer is over the list", () => {
    render(<LiveRooms rooms={rooms(6)} />);
    fireEvent.mouseEnter(screen.getByRole("list"));
    act(() => vi.advanceTimersByTime(25_000));
    expect(screen.getByText("Show 1")).toBeInTheDocument();

    fireEvent.mouseLeave(screen.getByRole("list"));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByText("Show 1")).not.toBeInTheDocument();
  });
});
