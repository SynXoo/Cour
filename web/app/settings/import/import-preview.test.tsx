import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { components } from "@/lib/api/schema";
import type { ImportJobDetail, ImportRow } from "@/lib/imports";
import { ImportPreview } from "./import-preview";

type AnimeSummary = components["schemas"]["AnimeSummary"];

const commitMutate = vi.fn();
vi.mock("@/lib/hooks/use-import", () => ({
  useCommitImport: () => ({ mutate: commitMutate, isPending: false }),
}));

// The picker gets its own dialog + search stack; here it collapses to a
// button that immediately "finds" a canned result.
vi.mock("./anime-picker", () => ({
  AnimePicker: ({
    onPick,
    onOpenChange,
  }: {
    onPick: (a: AnimeSummary) => void;
    onOpenChange: (open: boolean) => void;
  }) => (
    <button
      onClick={() => {
        onPick(anime(777, "Picked Show"));
        onOpenChange(false);
      }}
    >
      pick canned result
    </button>
  ),
}));

function anime(id: number, title = `Anime ${id}`): AnimeSummary {
  return {
    id,
    slug: `anime-${id}`,
    title,
    title_english: null,
    cover_image: null,
    cover_color: null,
    format: "TV",
    status: "FINISHED",
    season: null,
    season_year: null,
    episodes_count: 12,
    average_score: null,
    popularity: 0,
    genres: [],
    next_airing_at: null,
    next_airing_episode: null,
  };
}

function row(overrides: Partial<ImportRow> & { row_index: number; title: string }): ImportRow {
  return {
    status: "watching",
    score: null,
    progress: 0,
    match: "id",
    anime: overrides.match === "review" ? null : anime(1000 + overrides.row_index),
    on_list: false,
    ...overrides,
  };
}

function job(rows: ImportRow[], counts?: Partial<ImportJobDetail["counts"]>): ImportJobDetail {
  const review = rows.filter((r) => r.match === "review").length;
  return {
    id: 1,
    source: "mal",
    status: "ready",
    error: null,
    created_at: "2026-07-07T00:00:00Z",
    updated_at: "2026-07-07T00:00:00Z",
    rows,
    counts: {
      total: rows.length,
      matched: rows.length - review,
      review,
      conflicts: rows.filter((r) => r.on_list).length,
      applied: 0,
      skipped: 0,
      ...counts,
    },
  };
}

describe("ImportPreview", () => {
  beforeEach(() => {
    commitMutate.mockClear();
  });

  it("buckets rows into review and matched sections", () => {
    render(
      <ImportPreview
        job={job([
          row({ row_index: 0, title: "Sure Thing" }),
          row({ row_index: 1, title: "Mystery Show", match: "review" }),
        ])}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Needs review (1)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Matched (1)" })).toBeInTheDocument();
    expect(screen.getByText("Mystery Show")).toBeInTheDocument();
  });

  it("commits with the chosen mode and no resolutions by default", async () => {
    const user = userEvent.setup();
    render(
      <ImportPreview
        job={job([row({ row_index: 0, title: "Sure Thing" })])}
        onDiscard={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Overwrite — the import wins" }));
    expect(
      screen.getByRole("button", { name: "Overwrite — the import wins" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Apply import" }));
    expect(commitMutate).toHaveBeenCalledWith({ mode: "overwrite", resolutions: undefined });
  });

  it("resolves a review row through the picker and sends it with the commit", async () => {
    const user = userEvent.setup();
    render(
      <ImportPreview
        job={job([row({ row_index: 3, title: "Mystery Show", match: "review" })])}
        onDiscard={vi.fn()}
      />,
    );
    // Unresolved reviews alone leave nothing to import.
    expect(screen.getByRole("button", { name: "Apply import" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Find match" }));
    await user.click(screen.getByRole("button", { name: "pick canned result" }));
    expect(screen.getByText("Picked Show")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply import" }));
    expect(commitMutate).toHaveBeenCalledWith({
      mode: "merge",
      resolutions: [{ row_index: 3, anime_id: 777 }],
    });
  });

  it("excludes and restores a matched row", async () => {
    const user = userEvent.setup();
    render(
      <ImportPreview
        job={job([
          row({ row_index: 0, title: "Keep Me" }),
          row({ row_index: 1, title: "Drop Me" }),
        ])}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText("2 to import")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Leave out Drop Me" }));
    expect(screen.getByText(/1 to import · 1 excluded/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Include Drop Me again" }));
    expect(screen.getByText("2 to import")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply import" }));
    expect(commitMutate).toHaveBeenCalledWith({ mode: "merge", resolutions: undefined });
  });

  it("merge counts preview-time conflicts as kept, overwrite imports them", async () => {
    const user = userEvent.setup();
    render(
      <ImportPreview
        job={job([
          row({ row_index: 0, title: "New Show" }),
          row({ row_index: 1, title: "Old Favourite", on_list: true }),
        ])}
        onDiscard={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 to import · 1 kept as-is/)).toBeInTheDocument();
    expect(screen.getByText(/1 title is already on your list/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Overwrite — the import wins" }));
    expect(screen.getByText("2 to import")).toBeInTheDocument();
  });

  it("marks title matches and offers a re-match that overrides the target", async () => {
    const user = userEvent.setup();
    render(
      <ImportPreview
        job={job([
          row({ row_index: 0, title: "Fuzzy Show", match: "title" }),
        ])}
        onDiscard={vi.fn()}
      />,
    );
    const item = screen.getByText("title match").closest("li")!;
    await user.click(within(item).getByRole("button", { name: /Change match/ }));
    await user.click(screen.getByRole("button", { name: "pick canned result" }));

    expect(screen.getByText("re-matched")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply import" }));
    expect(commitMutate).toHaveBeenCalledWith({
      mode: "merge",
      resolutions: [{ row_index: 0, anime_id: 777 }],
    });
  });

  it("discarding takes a second, explicit click", async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    render(
      <ImportPreview job={job([row({ row_index: 0, title: "X" })])} onDiscard={onDiscard} />,
    );
    await user.click(screen.getByRole("button", { name: "Discard preview" }));
    expect(onDiscard).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Really discard?" }));
    expect(onDiscard).toHaveBeenCalledOnce();
  });

  it("surfaces a recorded apply error", () => {
    const failed = { ...job([row({ row_index: 0, title: "X" })]), error: "the database hiccuped" };
    render(<ImportPreview job={failed} onDiscard={vi.fn()} />);
    expect(screen.getByText(/the database hiccuped/)).toBeInTheDocument();
  });
});
