import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailClient } from "./verify-client";

export const metadata: Metadata = { title: "Verify email" };

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailClient />
    </Suspense>
  );
}
