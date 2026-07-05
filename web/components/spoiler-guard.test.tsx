import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SpoilerGuard } from "./spoiler-guard";

describe("SpoilerGuard", () => {
  it("renders content directly when not a spoiler", () => {
    render(<SpoilerGuard active={false}>the twist</SpoilerGuard>);
    expect(screen.queryByTestId("spoiler-guard")).not.toBeInTheDocument();
    expect(screen.getByText("the twist")).toBeVisible();
  });

  it("hides spoiler content behind a reveal button", async () => {
    render(<SpoilerGuard active>the twist</SpoilerGuard>);
    expect(screen.getByTestId("spoiler-guard")).toBeInTheDocument();

    // Content is aria-hidden while blurred.
    expect(screen.getByText("the twist").closest("[aria-hidden]")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /spoilers/i }));
    expect(screen.queryByTestId("spoiler-guard")).not.toBeInTheDocument();
    expect(screen.getByText("the twist")).toBeVisible();
  });

  it("is keyboard revealable", async () => {
    render(<SpoilerGuard active>secret</SpoilerGuard>);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: /spoilers/i })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("secret")).toBeVisible();
  });
});
