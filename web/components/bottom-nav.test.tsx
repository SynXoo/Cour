import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BottomNav } from "./bottom-nav";

const usePathname = vi.fn<() => string>();
vi.mock("next/navigation", () => ({
  usePathname: () => usePathname(),
}));

const useSession = vi.fn<() => { status: string }>();
vi.mock("@/lib/auth/session", () => ({
  useSession: () => useSession(),
}));

describe("BottomNav", () => {
  beforeEach(() => {
    usePathname.mockReturnValue("/");
    useSession.mockReturnValue({ status: "anon" });
  });

  it("renders the four tab links and a menu button", () => {
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Seasonal" })).toHaveAttribute("href", "/seasonal");
    expect(screen.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: "My list" })).toHaveAttribute("href", "/list");
    expect(screen.getByRole("button", { name: "Menu" })).toBeInTheDocument();
  });

  it("marks the tab matching the current route, including subroutes", () => {
    usePathname.mockReturnValue("/seasonal/2026/spring");
    render(<BottomNav />);
    expect(screen.getByRole("link", { name: "Seasonal" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("opens the menu sheet with the browse destinations", async () => {
    const user = userEvent.setup();
    render(<BottomNav />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(await screen.findByRole("link", { name: "Threads" })).toHaveAttribute(
      "href",
      "/threads",
    );
    expect(screen.getByRole("link", { name: "Schedule" })).toHaveAttribute("href", "/schedule");
    expect(screen.getByRole("link", { name: "Trending" })).toHaveAttribute("href", "/trending");
    expect(screen.getByRole("link", { name: "Hidden Gems" })).toHaveAttribute(
      "href",
      "/hidden-gems",
    );
    // Personal destinations stay out of the anon menu.
    expect(screen.queryByRole("link", { name: "Feed" })).not.toBeInTheDocument();
  });

  it("adds personal destinations for signed-in users", async () => {
    useSession.mockReturnValue({ status: "authed" });
    const user = userEvent.setup();
    render(<BottomNav />);
    await user.click(screen.getByRole("button", { name: "Menu" }));
    expect(await screen.findByRole("link", { name: "Feed" })).toHaveAttribute("href", "/feed");
    expect(screen.getByRole("link", { name: "For you" })).toHaveAttribute(
      "href",
      "/recommendations",
    );
  });
});
