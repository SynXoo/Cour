import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { InboxClient } from "./inbox-client";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage() {
  return (
    <PageShell width="reading">
      <InboxClient />
    </PageShell>
  );
}
