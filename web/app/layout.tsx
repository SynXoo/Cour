import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";
import { Providers } from "@/components/providers";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { cn } from "@/lib/utils";

const jetbrainsMono = JetBrains_Mono({subsets:['latin'],variable:'--font-mono'});

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Extend the page under the notch/home-indicator so the header and bottom
// tab bar can pad themselves with env(safe-area-inset-*).
export const viewport: Viewport = {
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "Cour — this season, together",
    template: "%s · Cour",
  },
  description:
    "Track what you watch, discuss every episode, and discover what's actually trending this season.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", geistSans.variable, geistMono.variable, "font-mono", jetbrainsMono.variable)}
      suppressHydrationWarning
    >
      {/* Mobile bottom padding = the fixed 4-rem tab bar + safe area. */}
      <body className="flex min-h-full flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Providers>
          <SiteHeader />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          <BottomNav />
        </Providers>
      </body>
    </html>
  );
}
