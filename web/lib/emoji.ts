import type { components } from "@/lib/api/schema";

export type Emoji = components["schemas"]["Emoji"];

/** The reaction vocabulary, in the order the server sorts counts. */
export const EMOJI_ORDER: Emoji[] = ["+1", "heart", "laugh", "surprise", "cry", "fire"];

/** Glyph per reaction — comment chips, the picker, and party reactions share it. */
export const EMOJI_GLYPHS: Record<Emoji, string> = {
  "+1": "👍",
  heart: "❤️",
  laugh: "😂",
  surprise: "😮",
  cry: "😢",
  fire: "🔥",
};
