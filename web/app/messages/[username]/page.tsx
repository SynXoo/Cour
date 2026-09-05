import type { Metadata } from "next";
import { PageShell } from "@/components/page-shell";
import { ConversationClient } from "./conversation-client";

type Params = { username: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { username } = await params;
  return { title: `Messages with @${username}` };
}

export default async function ConversationPage({ params }: { params: Promise<Params> }) {
  const { username } = await params;
  return (
    <PageShell width="reading">
      <ConversationClient username={username} />
    </PageShell>
  );
}
