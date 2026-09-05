import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { FriendsClient } from "./friends-client";

export const metadata: Metadata = { title: "Friends" };

export default function FriendsPage() {
  return (
    <PageShell width="reading">
      <FriendsClient />
    </PageShell>
  );
}
