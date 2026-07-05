"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  browserApi,
  refreshSession,
  setAccessToken,
  type SessionUser,
} from "@/lib/api/client";

type Status = "loading" | "authed" | "anon";

type SessionContextValue = {
  status: Status;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (email: string, username: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  /** Re-read /auth/me (e.g. after a profile edit). */
  reload: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function toAuthError(err: { error: { code: string; message: string; details?: unknown } }): AuthError {
  return new AuthError(err.error.message, err.error.code, err.error.details);
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<SessionUser | null>(null);

  const apply = useCallback((u: SessionUser | null) => {
    setUser(u);
    setStatus(u ? "authed" : "anon");
  }, []);

  // Session hydration: the refresh cookie (if any) becomes a live session.
  useEffect(() => {
    let cancelled = false;
    refreshSession().then((u) => {
      if (!cancelled) apply(u);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await browserApi.POST("/auth/login", {
        body: { email, password },
      });
      if (res.error) throw toAuthError(res.error);
      setAccessToken(res.data.access_token);
      apply(res.data.user);
      return res.data.user;
    },
    [apply],
  );

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      const res = await browserApi.POST("/auth/register", {
        body: { email, username, password },
      });
      if (res.error) throw toAuthError(res.error);
      setAccessToken(res.data.access_token);
      apply(res.data.user);
      return res.data.user;
    },
    [apply],
  );

  const logout = useCallback(async () => {
    await browserApi.POST("/auth/logout", {});
    setAccessToken(null);
    apply(null);
  }, [apply]);

  const reload = useCallback(async () => {
    const res = await browserApi.GET("/auth/me", {});
    if (res.data) apply(res.data);
  }, [apply]);

  const value = useMemo(
    () => ({ status, user, login, register, logout, reload }),
    [status, user, login, register, logout, reload],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
