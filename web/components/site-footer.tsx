export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="mx-auto flex w-full max-w-[88rem] flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          Anime metadata provided by{" "}
          <a
            href="https://anilist.co"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            AniList
          </a>
          .
        </p>
        <p>
          Cour never hosts or links to streams — bring your own legal source.
        </p>
      </div>
    </footer>
  );
}
