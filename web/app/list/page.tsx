import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { MyListClient } from "./my-list-client";

export const metadata: Metadata = { title: "My list" };

export default function MyListPage() {
  return (
    <PageShell width="browse">
      <MyListClient />
    </PageShell>
  );
}
