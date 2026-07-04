export default function HomePage() {
  return (
    <section className="flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
        Anime tracking for people watching{" "}
        <span className="text-primary">this season</span>
      </h1>
      <p className="max-w-xl text-balance text-muted-foreground">
        Seasonal charts, recency-weighted trending, weekly episode threads, and
        recommendations from people with your taste — not a museum of all-time
        rankings.
      </p>
      <p className="rounded-full border border-dashed border-border px-4 py-1.5 text-sm text-muted-foreground">
        Under construction — the seasonal catalog lands here first.
      </p>
    </section>
  );
}
