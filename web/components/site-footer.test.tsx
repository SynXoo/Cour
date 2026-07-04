import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("attributes AniList as the data source", () => {
    render(<SiteFooter />);
    const link = screen.getByRole("link", { name: /anilist/i });
    expect(link).toHaveAttribute("href", "https://anilist.co");
  });
});
