"use client";

import { useState, useSyncExternalStore } from "react";
import { useSession } from "@/lib/auth/session";
import { greetingFor } from "@/lib/home";

const emptySubscribe = () => () => {};

/**
 * "Good evening, sakuga_sam — …" — time-of-day comes from the viewer's
 * clock and the name from the client session, so neither is server
 * knowledge. The store trick is a hydration-safe mounted gate (the server
 * snapshot renders the placeholder, the first client pass flips it) and the
 * lazy initializer reads the clock without an impure render. The reserved
 * line height keeps the header from jumping when the line fades in.
 */
export function Greeting() {
  const { user } = useSession();
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [hour] = useState(() => new Date().getHours());

  return (
    <p
      className={`min-h-5 text-sm text-muted-foreground transition-opacity duration-500 ${
        hydrated ? "opacity-100" : "opacity-0"
      }`}
    >
      {hydrated && (
        <>
          {greetingFor(hour)}
          {user ? `, ${user.username}` : ""}
          {" — here's what's happening."}
        </>
      )}
    </p>
  );
}
