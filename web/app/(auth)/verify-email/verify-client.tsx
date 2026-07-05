"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/client";

type State = "verifying" | "done" | "failed" | "missing";

export function VerifyEmailClient() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<State>(token ? "verifying" : "missing");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    browserApi
      .POST("/auth/verify-email", { body: { token } })
      .then((res) => {
        if (!cancelled) setState(res.error ? "failed" : "done");
      })
      .catch(() => {
        if (!cancelled) setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const copy: Record<State, { title: string; body: string }> = {
    verifying: { title: "Verifying…", body: "One moment." },
    done: { title: "Email verified ✓", body: "You're all set." },
    failed: {
      title: "Link invalid or expired",
      body: "Sign in and request a fresh verification email from settings.",
    },
    missing: { title: "Missing token", body: "Use the link from your verification email." },
  };

  return (
    <div className="space-y-3 text-center">
      <h1 className="text-2xl font-bold tracking-tight">{copy[state].title}</h1>
      <p className="text-sm text-muted-foreground">{copy[state].body}</p>
      <Button variant="outline" asChild>
        <Link href="/">Back to Cour</Link>
      </Button>
    </div>
  );
}
