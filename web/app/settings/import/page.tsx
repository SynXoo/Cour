import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { ImportClient } from "./import-client";

export const metadata: Metadata = { title: "Import your list" };

export default function ImportPage() {
  return (
    // Reading width: the preview rows want more room than the settings form.
    <PageShell width="reading">
      <ImportClient />
    </PageShell>
  );
}
