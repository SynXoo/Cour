"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "@/lib/auth/session";
import { useIsMobile } from "@/lib/hooks/use-is-mobile";

export function Providers({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
        <SessionProvider>
          {children}
          {/* Top-center on mobile — bottom toasts would collide with the
              tab bar. mobileOffset keeps them clear of the notch now that
              the viewport extends under it. */}
          <Toaster
            richColors
            position={isMobile ? "top-center" : "bottom-right"}
            mobileOffset={{ top: "calc(env(safe-area-inset-top) + 1rem)" }}
          />
        </SessionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
