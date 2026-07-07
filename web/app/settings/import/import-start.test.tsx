import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportStart } from "./import-start";

const anilistMutate = vi.fn();
const malMutate = vi.fn();
vi.mock("@/lib/hooks/use-import", () => ({
  useStartAniListImport: () => ({ mutate: anilistMutate, isPending: false }),
  useStartMALImport: () => ({ mutate: malMutate, isPending: false }),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

describe("ImportStart", () => {
  beforeEach(() => {
    anilistMutate.mockClear();
    malMutate.mockClear();
    toastError.mockClear();
  });

  it("gates the AniList submit on a plausible username", async () => {
    const user = userEvent.setup();
    render(<ImportStart onStarted={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Fetch my list" });
    expect(button).toBeDisabled();

    await user.type(screen.getByLabelText("AniList username"), "  s  ");
    expect(button).toBeDisabled(); // whitespace doesn't count

    await user.clear(screen.getByLabelText("AniList username"));
    await user.type(screen.getByLabelText("AniList username"), " sakuga_sam ");
    expect(button).toBeEnabled();

    await user.click(button);
    expect(anilistMutate).toHaveBeenCalledWith("sakuga_sam", expect.anything());
  });

  it("uploads a chosen export file", async () => {
    const user = userEvent.setup();
    render(<ImportStart onStarted={vi.fn()} />);
    const file = new File(["<myanimelist/>"], "animelist.xml", { type: "text/xml" });
    await user.upload(screen.getByLabelText("Export file"), file);
    expect(malMutate).toHaveBeenCalledWith(file, expect.anything());
  });

  it("rejects an oversized file before uploading", async () => {
    const user = userEvent.setup();
    render(<ImportStart onStarted={vi.fn()} />);
    const big = new File(["x"], "huge.xml", { type: "text/xml" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    await user.upload(screen.getByLabelText("Export file"), big);
    expect(malMutate).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });
});
