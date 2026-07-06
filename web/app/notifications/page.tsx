import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { NotificationsClient } from "./notifications-client";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <PageShell width="reading">
      <NotificationsClient />
    </PageShell>
  );
}
