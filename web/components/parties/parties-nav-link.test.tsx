import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PartiesLiveCount, PartiesLiveDot, PartiesNavLink } from "./parties-nav-link";

let pulse: { rooms: number; watching: number } | null = null;
vi.mock("@/lib/hooks/use-parties", () => ({
  usePartyPulse: () => pulse,
}));

beforeEach(() => {
  pulse = null;
});

describe("PartiesNavLink", () => {
  it("is a plain link into the hub while nothing is open", () => {
    render(<PartiesNavLink />);
    const link = screen.getByRole("link", { name: "Parties" });
    expect(link).toHaveAttribute("href", "/parties");
    expect(screen.queryByLabelText(/watching/)).not.toBeInTheDocument();
  });

  it("carries the live count once a room opens", () => {
    pulse = { rooms: 1, watching: 4 };
    render(<PartiesNavLink />);
    expect(screen.getByLabelText("1 party open, 4 watching")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("pluralises rooms", () => {
    pulse = { rooms: 3, watching: 11 };
    render(<PartiesNavLink />);
    expect(screen.getByLabelText("3 parties open, 11 watching")).toBeInTheDocument();
  });
});

describe("the mobile tab's signals", () => {
  it("render nothing on a quiet night", () => {
    const dot = render(<PartiesLiveDot />);
    expect(dot.container).toBeEmptyDOMElement();
    const count = render(<PartiesLiveCount />);
    expect(count.container).toBeEmptyDOMElement();
  });

  it("keep the dot decorative and put the count in words", () => {
    pulse = { rooms: 2, watching: 5 };
    const { container } = render(
      <>
        <PartiesLiveDot />
        <PartiesLiveCount />
      </>,
    );
    // The dot must not join the tab's accessible name ahead of its label.
    expect(container.querySelector("[aria-hidden]")).toBeInTheDocument();
    expect(container.textContent).toBe(", 2 open now");
  });
});
