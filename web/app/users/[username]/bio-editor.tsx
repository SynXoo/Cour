"use client";

import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { browserApi } from "@/lib/api/client";

const MAX_BIO = 500; // mirrors profiles.maxBioLen

/**
 * The bio, editable where it's read. Settings still owns the field, but a
 * profile that's about to be public should be fixable from the page people
 * will see — sending someone to /settings to write one sentence is how bios
 * stay empty.
 */
export function BioEditor({
  bio,
  isOwner,
  onSaved,
}: {
  bio: string;
  isOwner: boolean;
  onSaved: (bio: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    if (bio) {
      return (
        <div className="group/bio flex max-w-prose items-start gap-2">
          <p className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/90">
            {bio}
          </p>
          {isOwner && <EditButton className="opacity-0 group-hover/bio:opacity-100 focus-visible:opacity-100" onClick={() => setEditing(true)} />}
        </div>
      );
    }
    if (!isOwner) return null;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex w-fit items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
      >
        <PencilSimpleIcon aria-hidden />
        Add a bio — say what you&apos;re watching for
      </button>
    );
  }

  return (
    <BioForm
      bio={bio}
      onDone={(next) => {
        if (next !== null) onSaved(next);
        setEditing(false);
      }}
    />
  );
}

/** Split out so the draft state is born fresh on every open — no reset effect. */
function BioForm({ bio, onDone }: { bio: string; onDone: (bio: string | null) => void }) {
  const [draft, setDraft] = useState(bio);

  const save = useMutation({
    mutationFn: async (next: string) => {
      const res = await browserApi.PATCH("/me/profile", { body: { bio: next } });
      if (res.error) throw new Error(res.error.error.message);
      return next;
    },
    // The server trims; echoing its own answer back keeps the page honest.
    onSuccess: (next) => {
      toast.success(next ? "Bio updated" : "Bio cleared");
      onDone(next.trim());
    },
    onError: (err) => toast.error(err.message || "Could not save your bio"),
  });

  const tooLong = draft.length > MAX_BIO;

  return (
    <div className="max-w-prose space-y-2">
      <Textarea
        autoFocus
        rows={3}
        value={draft}
        aria-label="Bio"
        aria-invalid={tooLong}
        placeholder="Seasonal watcher. Sakuga apologist. Will defend the ending."
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-11 md:h-8"
          disabled={save.isPending || tooLong}
          onClick={() => save.mutate(draft)}
        >
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-11 md:h-8"
          disabled={save.isPending}
          onClick={() => onDone(null)}
        >
          Cancel
        </Button>
        <span
          className={`ms-auto font-mono text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}
        >
          {draft.length}/{MAX_BIO}
        </span>
      </div>
    </div>
  );
}

function EditButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Edit bio"
      className={`shrink-0 rounded-md p-1 text-muted-foreground transition hover:text-foreground ${className ?? ""}`}
    >
      <PencilSimpleIcon aria-hidden />
    </button>
  );
}
