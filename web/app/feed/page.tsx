import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { FeedClient } from "./feed-client";

export const metadata: Metadata = { title: "Feed" };

export default function FeedPage() {
  return (
    <PageShell width="reading">
      <FeedClient />
    </PageShell>
  );
}
