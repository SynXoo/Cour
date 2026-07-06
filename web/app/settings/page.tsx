import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { SettingsClient } from "./settings-client";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageShell width="form">
      <SettingsClient />
    </PageShell>
  );
}
