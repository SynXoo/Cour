import { redirect } from "next/navigation";
import { currentSeason } from "@/lib/anime";

export default function SeasonalIndexPage() {
  const { season, year } = currentSeason();
  redirect(`/seasonal/${year}/${season.toLowerCase()}`);
}
