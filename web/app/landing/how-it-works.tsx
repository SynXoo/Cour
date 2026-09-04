const STEPS = [
  {
    n: "01",
    accent: "border-primary/30 text-primary",
    title: "Bring your list",
    body: "Import from MAL or AniList in a couple of minutes, or just tap the shows you're watching this season when you sign up.",
  },
  {
    n: "02",
    accent: "border-gold/30 text-gold",
    title: "Watch, then +1",
    body: "Watch wherever you legally watch — Cour never hosts or links to streams. Bump your progress and your list keeps itself.",
  },
  {
    n: "03",
    accent: "border-live/30 text-live",
    title: "Talk in the room",
    body: "Every episode has a live thread. What you haven't seen yet stays blurred, so the conversation is safe to join mid-season.",
  },
];

/** Three plain steps under the tour — the whole loop, in one glance. */
export function HowItWorks() {
  return (
    <ol className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {STEPS.map((s) => (
        <li key={s.n} className="relative rounded-2xl border border-border/60 bg-card/50 p-5 pt-6">
          <span
            className={`absolute -top-3 left-5 rounded-full border bg-background px-2.5 py-0.5 font-mono text-xs font-semibold ${s.accent}`}
          >
            {s.n}
          </span>
          <h3 className="text-base font-semibold tracking-tight">{s.title}</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}
