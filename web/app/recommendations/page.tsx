import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { RecommendationsClient } from "./recs-client";

export const metadata: Metadata = { title: "For you" };

export default function RecommendationsPage() {
  return (
    <PageShell width="browse">
      <RecommendationsClient />
    </PageShell>
  );
}
