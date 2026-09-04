import { describe, expect, it } from "vitest";
import { badgeTone, roomHref, roomLabel, streakMessage, weekLetters } from "./pulse";

describe("roomHref / roomLabel", () => {
  it("routes episode rooms to the episode page and series rooms to the board", () => {
    expect(roomHref(5, "episode", 7)).toBe("/anime/5/episode/7");
    expect(roomHref(5, "series", null)).toBe("/anime/5/discussion");
    expect(roomHref(5, "episode", null)).toBe("/anime/5/discussion");
    expect(roomLabel("episode", 7)).toBe("Ep 7 room");
    expect(roomLabel("series", null)).toBe("Series room");
  });
});

describe("streakMessage", () => {
  const base = { best: 0, week: [false, false, false, false, false, false, false] };
  it("celebrates an active day and asks for tomorrow", () => {
    expect(streakMessage({ ...base, current: 1, active_today: true })).toMatch(/Day one/);
    expect(streakMessage({ ...base, current: 5, active_today: true })).toMatch(/Locked in/);
  });
  it("nudges when today is still open", () => {
    expect(streakMessage({ ...base, current: 3, active_today: false })).toMatch(/keeps it going/);
  });
  it("invites a restart, citing the best run when there was one", () => {
    expect(streakMessage({ ...base, current: 0, active_today: false })).toMatch(/Start a streak/);
    expect(streakMessage({ ...base, current: 0, active_today: false, best: 9 })).toMatch(/Best run: 9/);
  });
});

describe("badgeTone", () => {
  it("maps tiers onto the accent palette", () => {
    expect(badgeTone("gold")).toContain("text-gold");
    expect(badgeTone("silver")).toContain("text-lilac");
    expect(badgeTone("bronze")).toContain("text-live");
  });
});

describe("weekLetters", () => {
  it("ends on today and runs back seven days", () => {
    // 2026-09-04 is a Friday.
    expect(weekLetters(new Date(2026, 8, 4))).toEqual(["S", "S", "M", "T", "W", "T", "F"]);
  });
});
