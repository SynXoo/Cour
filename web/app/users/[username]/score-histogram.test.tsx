import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScoreHistogram } from "./score-histogram";

// Radix Tooltip's positioning needs ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

function buckets(counts: Partial<Record<number, number>>) {
  return Array.from({ length: 10 }, (_, i) => ({
    score: i + 1,
    count: counts[i + 1] ?? 0,
  }));
}

describe("ScoreHistogram", () => {
  it("renders one clickable bar per score and reports picks", async () => {
    const onPick = vi.fn();
    render(
      <ScoreHistogram
        histogram={buckets({ 7: 3, 8: 5 })}
        ratedCount={8}
        username="sam"
        onPick={onPick}
      />,
    );

    const bars = screen.getAllByRole("button");
    expect(bars).toHaveLength(10);

    await userEvent.click(screen.getByRole("button", { name: /5 rated 8/ }));
    expect(onPick).toHaveBeenCalledWith(8);
  });

  it("shows the empty prompt when nothing is rated", () => {
    render(
      <ScoreHistogram histogram={buckets({})} ratedCount={0} username="sam" onPick={vi.fn()} />,
    );
    expect(screen.getByText(/No ratings yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
