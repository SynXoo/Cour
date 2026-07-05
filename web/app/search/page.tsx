import type { Metadata } from "next";
import { SearchClient } from "./search-client";

export const metadata: Metadata = {
  title: "Search",
  description: "Find any anime by title — typo-friendly search across the Cour catalog.",
};

export default function SearchPage() {
  return <SearchClient />;
}
