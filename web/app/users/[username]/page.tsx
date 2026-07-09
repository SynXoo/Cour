import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { serverApi } from "@/lib/api/client";
import type { UserProfile } from "@/lib/profile";
import { ProfileView } from "./profile-view";

type Params = { username: string };

async function fetchProfile(username: string): Promise<UserProfile | null> {
  const res = await serverApi()
    .GET("/users/{username}", {
      params: { path: { username } },
      // Profiles change often (list activity); keep SSR fresh-ish.
      fetch: (input: Request) => fetch(input, { next: { revalidate: 60 } }),
    })
    .catch(() => null);
  return res?.data ?? null;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { username } = await params;
  return {
    title: `@${username}`,
    description: `${username}'s anime list, stats, and favorites on Cour.`,
  };
}

export default async function ProfilePage({ params }: { params: Promise<Params> }) {
  const { username } = await params;
  const profile = await fetchProfile(username);
  if (!profile) notFound();

  return <ProfileView profile={profile} />;
}
