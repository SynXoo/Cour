import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClockControls } from "@/lib/hooks/use-party";
import type { PartyMessage } from "@/lib/parties";
import { LiveChat } from "./live-chat";

const controls = (): ClockControls => ({
  play: vi.fn(),
  pause: vi.fn(),
  seek: vi.fn(),
  chat: vi.fn(),
  react: vi.fn(),
});

const msg = (id: number, over: Partial<PartyMessage> = {}): PartyMessage => ({
  id,
  kind: "chat",
  from: { id: 2, username: "amy", avatar_url: null },
  body: `line ${id}`,
  emoji: null,
  position: null,
  at: "2026-09-05T20:00:00Z",
  comment_id: null,
  ...over,
});

const anchor = { clock: { position: 754, playing: false, at: "x", duration: null }, receivedAt: 0 };

beforeEach(() => {
  window.localStorage.clear();
});

describe("LiveChat", () => {
  it("renders lines and reactions, marking saved ones", () => {
    render(
      <LiveChat
        messages={[
          msg(1),
          msg(2, { kind: "react", body: null, emoji: "fire", position: 754 }),
          msg(3, { body: "keeper", comment_id: 99, position: 800 }),
        ]}
        anchor={anchor}
        controls={controls()}
        live
        viewer="me"
        episodeHref="/anime/1/episode/3"
        error={null}
      />,
    );
    expect(screen.getByText("line 1")).toBeInTheDocument();
    expect(screen.getByText(/reacted fire/)).toBeInTheDocument();
    expect(screen.getByText(/at 12:34/)).toBeInTheDocument();
    expect(screen.getByText(/saved · 13:20/)).toBeInTheDocument();
  });

  it("sends on Enter with the persist flag from the switch, and reacts at the clock position", () => {
    const c = controls();
    render(
      <LiveChat
        messages={[]}
        anchor={anchor}
        controls={c}
        live
        viewer="me"
        episodeHref="/x"
        error={null}
      />,
    );
    const box = screen.getByLabelText("Chat message");
    fireEvent.change(box, { target: { value: "  hello  " } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(c.chat).toHaveBeenCalledWith("hello", false);
    expect(box).toHaveValue("");

    // Shift+Enter is a newline, not a send.
    fireEvent.change(box, { target: { value: "multi" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(c.chat).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.keyDown(box, { key: "Enter" });
    expect(c.chat).toHaveBeenLastCalledWith("multi", true);
    expect(window.localStorage.getItem("cour:party:persist")).toBe("1");

    fireEvent.click(screen.getByRole("button", { name: /React fire at 12:34/ }));
    expect(c.react).toHaveBeenCalledWith("fire", 754, true);
  });

  it("disables sending while reconnecting and surfaces a bounced send", () => {
    const c = controls();
    render(
      <LiveChat
        messages={[]}
        anchor={null}
        controls={c}
        live={false}
        viewer="me"
        episodeHref="/x"
        error={{ code: "rate_limited", message: "slow" }}
      />,
    );
    expect(screen.getByLabelText("Chat message")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "React fire" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/too fast/);
  });
});
