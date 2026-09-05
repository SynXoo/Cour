import { describe, expect, it } from "vitest";
import {
  chronological,
  friendAction,
  friendMarkers,
  friendStandingLabel,
  sameGroup,
  splitMentions,
  type DirectMessage,
  type FriendOnAnime,
} from "./social";

const friend = (username: string, over: Partial<FriendOnAnime> = {}): FriendOnAnime => ({
  user: { username, avatar_url: null },
  status: "watching",
  progress: 0,
  score: null,
  ...over,
});

describe("friendAction", () => {
  it("maps every state to the verb the server expects", () => {
    expect(friendAction("none")).toMatchObject({ label: "Add friend", verb: "befriend" });
    expect(friendAction("request_received")).toMatchObject({ label: "Accept request", verb: "befriend" });
    expect(friendAction("request_sent")).toMatchObject({ verb: "unfriend", title: "Cancel request" });
    expect(friendAction("friends")).toMatchObject({ verb: "unfriend", title: "Unfriend" });
    expect(friendAction("self")).toBeNull();
  });
});

describe("splitMentions", () => {
  it("links word-start mentions and leaves everything else alone", () => {
    expect(splitMentions("cc @sakuga_sam, mail sam@cour.demo (@kai)")).toEqual([
      { kind: "text", value: "cc " },
      { kind: "mention", value: "sakuga_sam" },
      { kind: "text", value: ", mail sam@cour.demo (" },
      { kind: "mention", value: "kai" },
      { kind: "text", value: ")" },
    ]);
  });

  it("returns one text run when nothing matches", () => {
    expect(splitMentions("no handles here @ab @@nope")).toEqual([
      { kind: "text", value: "no handles here @ab @@nope" },
    ]);
    expect(splitMentions("")).toEqual([]);
  });

  it("keeps a mention that starts the body", () => {
    expect(splitMentions("@mia hi")).toEqual([
      { kind: "mention", value: "mia" },
      { kind: "text", value: " hi" },
    ]);
  });
});

describe("friendMarkers", () => {
  it("groups mid-show friends by progress and skips the rest", () => {
    const markers = friendMarkers([
      friend("a", { progress: 4 }),
      friend("b", { progress: 4 }),
      friend("c", { status: "paused", progress: 2 }),
      friend("d", { status: "completed", progress: 12 }),
      friend("e", { status: "planning" }),
      friend("f", { progress: 0 }),
    ]);
    expect([...markers.keys()]).toEqual([4, 2]);
    expect(markers.get(4)?.map((f) => f.user.username)).toEqual(["a", "b"]);
    expect(markers.get(2)?.map((f) => f.user.username)).toEqual(["c"]);
  });
});

describe("friendStandingLabel", () => {
  it("reads the entry back as a sentence fragment", () => {
    expect(friendStandingLabel(friend("a", { progress: 7, score: 9 }), 12)).toBe("on ep 7 of 12 · ★9");
    expect(friendStandingLabel(friend("a", { progress: 7 }), null)).toBe("on ep 7");
    expect(friendStandingLabel(friend("a", { status: "completed", score: 8 }), 12)).toBe("finished · ★8");
    expect(friendStandingLabel(friend("a", { status: "dropped", progress: 3 }), 12)).toBe("dropped at ep 3");
    expect(friendStandingLabel(friend("a", { status: "planning" }), 12)).toBe("plans to watch");
  });
});

describe("conversation helpers", () => {
  const msg = (id: number, mine: boolean, at: string): DirectMessage => ({
    id,
    mine,
    sender: mine ? "me" : "you",
    body: "…",
    created_at: at,
  });

  it("flattens newest-first pages into oldest-first bubbles", () => {
    const pages = [
      [msg(5, true, "2026-09-04T12:05:00Z"), msg(4, false, "2026-09-04T12:04:00Z")],
      [msg(2, false, "2026-09-04T12:00:00Z")],
    ];
    expect(chronological(pages).map((m) => m.id)).toEqual([2, 4, 5]);
  });

  it("groups same-sender bubbles within five minutes", () => {
    const a = msg(1, true, "2026-09-04T12:00:00Z");
    expect(sameGroup(a, msg(2, true, "2026-09-04T12:04:00Z"))).toBe(true);
    expect(sameGroup(a, msg(2, true, "2026-09-04T12:06:00Z"))).toBe(false);
    expect(sameGroup(a, msg(2, false, "2026-09-04T12:01:00Z"))).toBe(false);
  });
});
