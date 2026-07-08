"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { browserApi } from "@/lib/api/client";
import { useSession } from "@/lib/auth/session";
import type { Review } from "./review-card";

export function ReviewComposer({
  animeId,
  existing,
  onSaved,
}: {
  animeId: number;
  existing: Review | null;
  onSaved: () => void;
}) {
  const { status } = useSession();
  const [open, setOpen] = useState(false);

  if (status === "anon") {
    return (
      <Button variant="outline" asChild>
        <Link href="/login">Sign in to review</Link>
      </Button>
    );
  }
  if (status === "loading") return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{existing ? "Edit your review" : "Write a review"}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <ComposerForm
          animeId={animeId}
          existing={existing}
          close={() => setOpen(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function ComposerForm({
  animeId,
  existing,
  close,
  onSaved,
}: {
  animeId: number;
  existing: Review | null;
  close: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(existing?.body ?? "");
  const [score, setScore] = useState(existing ? String(existing.score) : "8");
  const [spoilers, setSpoilers] = useState(existing?.has_spoilers ?? false);
  const [saving, setSaving] = useState(false);

  const tooShort = body.trim().length < 100;

  async function save() {
    setSaving(true);
    try {
      const res = await browserApi.PUT("/anime/{id}/reviews/mine", {
        params: { path: { id: animeId } },
        body: { body: body.trim(), score: Number(score), has_spoilers: spoilers },
      });
      if (res.error) {
        const details = res.error.error.details as Record<string, string> | undefined;
        toast.error(details ? Object.values(details).join("; ") : res.error.error.message);
        return;
      }
      toast.success(existing ? "Review updated" : "Review posted");
      close();
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{existing ? "Edit your review" : "Write a review"}</DialogTitle>
        <DialogDescription>
          Long-form thoughts — at least 100 characters. Tag spoilers honestly;
          readers see a blur first.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="rc-body">Review</FieldLabel>
          <Textarea
            id="rc-body"
            rows={10}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What worked, what didn't, and who should watch it…"
          />
          <FieldDescription>
            {body.trim().length}/20000{tooShort ? " — needs at least 100 characters" : ""}
          </FieldDescription>
        </Field>

        <div className="flex flex-wrap items-end gap-6">
          <Field className="w-40">
            <FieldLabel htmlFor="rc-score">Score</FieldLabel>
            <Select value={score} onValueChange={setScore}>
              <SelectTrigger id="rc-score">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => 10 - i).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}/10
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <label className="flex items-center gap-2 pb-2 text-sm">
            <Checkbox
              checked={spoilers}
              onCheckedChange={(v) => setSpoilers(v === true)}
            />
            Contains spoilers
          </label>
        </div>
      </FieldGroup>

      <DialogFooter>
        <Button onClick={save} disabled={saving || tooShort}>
          {saving ? "Saving…" : existing ? "Update review" : "Post review"}
        </Button>
      </DialogFooter>
    </>
  );
}
