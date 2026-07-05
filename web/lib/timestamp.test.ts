import { describe, expect, it } from "vitest";
import { formatTimestamp, parseTimestamp } from "./timestamp";

describe("parseTimestamp", () => {
  it("parses mm:ss", () => {
    expect(parseTimestamp("12:34")).toBe(754);
    expect(parseTimestamp("0:00")).toBe(0);
    expect(parseTimestamp(" 5:07 ")).toBe(307);
  });

  it("parses h:mm:ss", () => {
    expect(parseTimestamp("1:02:03")).toBe(3723);
  });

  it("rejects junk", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("12")).toBeNull();
    expect(parseTimestamp("a:b")).toBeNull();
    expect(parseTimestamp("1:2:3:4")).toBeNull();
    expect(parseTimestamp("-1:00")).toBeNull();
  });
});

describe("formatTimestamp", () => {
  it("round-trips", () => {
    expect(formatTimestamp(754)).toBe("12:34");
    expect(formatTimestamp(3723)).toBe("1:02:03");
    expect(formatTimestamp(0)).toBe("0:00");
  });
});
