import type { Metadata } from "next";
import { MyListClient } from "./my-list-client";

export const metadata: Metadata = { title: "My list" };

export default function MyListPage() {
  return <MyListClient />;
}
