import Link from "next/link";
import { splitMentions } from "@/lib/social";

/**
 * A comment body with its @mentions turned into profile links. Whitespace
 * survives untouched (the parent keeps `whitespace-pre-line`); a body with
 * no mentions renders as one text node, so nothing changes for the common
 * case.
 */
export function MentionText({ body }: { body: string }) {
  const segments = splitMentions(body);
  if (segments.length <= 1 && segments[0]?.kind !== "mention") return <>{body}</>;
  return (
    <>
      {segments.map((seg, i) =>
        seg.kind === "mention" ? (
          <Link
            key={i}
            href={`/users/${seg.value}`}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            @{seg.value}
          </Link>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}
