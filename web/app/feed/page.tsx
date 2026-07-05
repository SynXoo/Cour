import type { Metadata } from "next";
import { FeedClient } from "./feed-client";

export const metadata: Metadata = { title: "Feed" };

export default function FeedPage() {
  return <FeedClient />;
}
