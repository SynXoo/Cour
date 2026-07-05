import type { Metadata } from "next";
import { RecommendationsClient } from "./recs-client";

export const metadata: Metadata = { title: "For you" };

export default function RecommendationsPage() {
  return <RecommendationsClient />;
}
