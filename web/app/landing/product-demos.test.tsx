import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductDemos } from "./product-demos";

function mockMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("ProductDemos", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders the three scenes with their copy", () => {
    mockMotion(false);
    render(<ProductDemos />);
    expect(screen.getByText("Every episode gets a room")).toBeInTheDocument();
    expect(screen.getByText("Spoilers wait for you")).toBeInTheDocument();
    expect(screen.getByText("Know what's on tonight")).toBeInTheDocument();
    // Theatre, not content: nothing here links anywhere.
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("plays: the room fills, the shield lifts, toasts land", () => {
    mockMotion(false);
    render(<ProductDemos />);
    expect(screen.getByTestId("room-comments").children).toHaveLength(1);
    expect(screen.getByTestId("shield-body")).toHaveAttribute("data-open", "false");
    expect(screen.getByTestId("toasts").children).toHaveLength(0);

    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByTestId("room-comments").children).toHaveLength(3);
    expect(screen.getByTestId("shield-ep")).toHaveTextContent("Ep 9");
    expect(screen.getByTestId("shield-body")).toHaveAttribute("data-open", "true");
    expect(screen.getByTestId("toasts").children).toHaveLength(2);
  });

  it("loops back to the start", () => {
    mockMotion(false);
    render(<ProductDemos />);
    act(() => vi.advanceTimersByTime(1700 * 6));
    expect(screen.getByTestId("room-comments").children).toHaveLength(1);
  });

  it("holds the finished frame under reduced motion", () => {
    mockMotion(true);
    render(<ProductDemos />);
    expect(screen.getByTestId("room-comments").children).toHaveLength(4);
    expect(screen.getByTestId("shield-body")).toHaveAttribute("data-open", "true");
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByTestId("room-comments").children).toHaveLength(4);
  });
});
