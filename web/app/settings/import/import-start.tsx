"use client";

import { UploadSimpleIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  useStartAniListImport,
  useStartMALImport,
} from "@/lib/hooks/use-import";
import type { ImportJob } from "@/lib/imports";

// Server-side caps (imports.go / the import spec) — checked client-side only
// to fail fast with a friendlier message.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function ImportStart({ onStarted }: { onStarted: (job: ImportJob) => void }) {
  const [username, setUsername] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const anilist = useStartAniListImport();
  const mal = useStartMALImport();
  const busy = anilist.isPending || mal.isPending;

  function startAniList(e: React.FormEvent) {
    e.preventDefault();
    anilist.mutate(username.trim(), { onSuccess: onStarted });
  }

  function startMAL(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("That file is over the 20 MiB limit — a list export is far smaller.");
      return;
    }
    mal.mutate(file, { onSuccess: onStarted });
    // Allow re-picking the same file after a failed upload.
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>From AniList</CardTitle>
            <CardDescription>
              By username — the list must be public. No login or API key needed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={startAniList} className="flex flex-col gap-3">
              <Field>
                <FieldLabel htmlFor="anilist-username">AniList username</FieldLabel>
                <Input
                  id="anilist-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. sakuga_sam"
                  autoComplete="off"
                  maxLength={30}
                  disabled={busy}
                />
              </Field>
              <Button
                type="submit"
                className="self-start"
                disabled={busy || username.trim().length < 2}
              >
                {anilist.isPending ? "Starting…" : "Fetch my list"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>From MyAnimeList</CardTitle>
            <CardDescription>
              Upload the official export — works even for long-dead accounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor="mal-file">Export file</FieldLabel>
              <input
                ref={fileInput}
                id="mal-file"
                type="file"
                accept=".xml,.gz,.xml.gz,text/xml,application/gzip"
                className="sr-only"
                onChange={(e) => startMAL(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                className="self-start"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <UploadSimpleIcon data-icon="inline-start" />
                {mal.isPending ? "Uploading…" : "Choose .xml or .xml.gz"}
              </Button>
              <FieldDescription>
                On MAL: Profile → Settings → “Export my list”.
              </FieldDescription>
            </Field>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Up to 10,000 entries per import. You review every match before anything
        is written — and imports never show up in follower feeds or trending.
      </p>
    </div>
  );
}
