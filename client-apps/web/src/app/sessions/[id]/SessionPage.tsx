"use client";

import { useParams } from "next/navigation";

/**
 * Placeholder page for an active session.
 * Full implementation is planned for T01.6 (Session View).
 */
export default function SessionPage() {
  const { id } = useParams<{ id: string }>();

  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">
        Session <span className="font-mono">{id}</span> — coming in T01.6
      </p>
    </div>
  );
}
