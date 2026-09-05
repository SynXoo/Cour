"use client";

import { PaperPlaneRightIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EMOJI_GLYPHS, EMOJI_ORDER, type Emoji } from "@/lib/emoji";
import type { ClockControls } from "@/lib/hooks/use-party";
import { CHAT_MAX_LEN, formatClock, positionAt, type ClockAnchor, type PartyMessage } from "@/lib/parties";
import { cn } from "@/lib/utils";

/**
 * Live chat + reactions (M4.3). One stream, oldest at the top, pinned to the
 * bottom while the reader is there; a reaction bar that stamps the current
 * clock position; a composer that sends on Enter. The "Also post to the
 * episode thread" switch is the author's opt-in for persistence — off by
 * default, remembered per browser.
 */
export function LiveChat({
  messages,
  anchor,
  controls,
  live,
  viewer,
  episodeHref,
  error,
}: {
  messages: PartyMessage[];
  anchor: ClockAnchor | null;
  controls: ClockControls;
  live: boolean;
  viewer: string | null;
  episodeHref: string;
  /** A transient send error from the socket (rate limit, language policy). */
  error: { code: string; message: string } | null;
}) {
  const [body, setBody] = useState("");
  const [persist, setPersist] = useState(() => readPersistPref());
  const listRef = useRef<HTMLOListElement>(null);
  const pinnedRef = useRef(true);

  // Follow the newest line only while the reader is already at the bottom;
  // scrolling up to re-read must not be yanked back.
  useEffect(() => {
    const el = listRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const togglePersist = (on: boolean) => {
    setPersist(on);
    writePersistPref(on);
  };

  const send = () => {
    const text = body.trim();
    if (!text || !live) return;
    controls.chat(text.slice(0, CHAT_MAX_LEN), persist);
    setBody("");
    pinnedRef.current = true;
  };

  const react = (emoji: Emoji) => {
    if (!live) return;
    const position = anchor ? positionAt(anchor) : undefined;
    controls.react(emoji, position, persist);
    pinnedRef.current = true;
  };

  return (
    <section aria-label="Live chat" className="flex flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">Live chat</h2>
        <div className="flex items-center gap-2">
          <Switch
            id="party-persist"
            checked={persist}
            onCheckedChange={togglePersist}
            aria-describedby="party-persist-hint"
          />
          <Label htmlFor="party-persist" className="text-xs font-normal text-muted-foreground">
            Also post to the episode thread
          </Label>
        </div>
      </div>
      <p id="party-persist-hint" className="sr-only">
        When on, your messages and reactions are also saved as timestamped comments on the
        episode thread.
      </p>

      <ol
        ref={listRef}
        onScroll={onScroll}
        aria-live="polite"
        aria-relevant="additions"
        className="flex max-h-[24rem] min-h-[12rem] flex-col gap-1.5 overflow-y-auto px-4 py-3 text-sm"
      >
        {messages.length === 0 && (
          <li className="my-auto text-center text-xs text-muted-foreground">
            Nothing said yet. Say hi, or fire off a reaction when something lands.
          </li>
        )}
        {messages.map((m) => (
          <ChatLine key={m.id} message={m} mine={m.from.username === viewer} />
        ))}
      </ol>

      <div className="flex flex-wrap gap-1 border-t border-border px-3 pt-2" aria-label="React">
        {EMOJI_ORDER.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => react(emoji)}
            disabled={!live}
            aria-label={`React ${emoji}${anchor ? ` at ${formatClock(positionAt(anchor))}` : ""}`}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-lg transition-colors hover:bg-muted disabled:opacity-50 md:min-h-9 md:min-w-9"
          >
            <span aria-hidden>{EMOJI_GLYPHS[emoji]}</span>
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2 px-3 pt-2 pb-3"
      >
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, CHAT_MAX_LEN))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={live ? "Say something…" : "Reconnecting…"}
          disabled={!live}
          rows={1}
          aria-label="Chat message"
          className="min-h-11 flex-1 resize-none md:min-h-9"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!live || !body.trim()}
          aria-label="Send"
          className="size-11 md:size-9"
        >
          <PaperPlaneRightIcon size={16} weight="fill" aria-hidden />
        </Button>
      </form>

      {error && (
        <p role="alert" className="px-4 pb-3 text-xs text-destructive">
          {error.code === "rate_limited" ? "Slow down a little — you're sending too fast." : error.message}
        </p>
      )}
      <p className="px-4 pb-3 text-[11px] text-muted-foreground">
        Chat here disappears with the party. Flip the switch to keep a line as a comment on{" "}
        <Link href={episodeHref} className="underline-offset-4 hover:underline">
          the episode thread
        </Link>
        , stamped to the clock.
      </p>
    </section>
  );
}

function ChatLine({ message, mine }: { message: PartyMessage; mine: boolean }) {
  const { from } = message;
  if (message.kind === "react") {
    const glyph = message.emoji ? EMOJI_GLYPHS[message.emoji] : "";
    return (
      <li className="flex items-center gap-2 text-xs text-muted-foreground" data-kind="react">
        <span className="text-base leading-none" aria-hidden>
          {glyph}
        </span>
        <span>
          <Link href={`/users/${from.username}`} className="font-medium text-foreground hover:text-primary">
            @{from.username}
          </Link>{" "}
          reacted {message.emoji}
          {message.position != null && (
            <span className="font-mono"> at {formatClock(message.position)}</span>
          )}
          {message.comment_id != null && <span title="Saved to the episode thread"> · saved</span>}
        </span>
      </li>
    );
  }
  return (
    <li className={cn("flex items-start gap-2", mine && "text-foreground")} data-kind="chat">
      <Avatar className="mt-0.5 h-6 w-6 text-[10px]">
        {from.avatar_url && <AvatarImage src={from.avatar_url} alt="" />}
        <AvatarFallback>{from.username.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <p className="min-w-0 flex-1 break-words">
        <Link href={`/users/${from.username}`} className="mr-1.5 font-medium hover:text-primary">
          @{from.username}
        </Link>
        <span className="whitespace-pre-wrap">{message.body}</span>
        {message.comment_id != null && (
          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground" title="Saved to the episode thread">
            saved{message.position != null ? ` · ${formatClock(message.position)}` : ""}
          </span>
        )}
      </p>
    </li>
  );
}

const PERSIST_KEY = "cour:party:persist";

function readPersistPref(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(PERSIST_KEY) === "1";
  } catch {
    return false;
  }
}

function writePersistPref(on: boolean) {
  try {
    window.localStorage.setItem(PERSIST_KEY, on ? "1" : "0");
  } catch {
    // Private mode etc.: the switch still works for this page view.
  }
}
