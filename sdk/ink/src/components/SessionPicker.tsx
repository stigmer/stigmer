import React, { useCallback, useMemo, useState } from "react";
import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { useSessionList } from "@stigmer/react";
import { type PickerItem, ResourcePicker } from "./ResourcePicker.js";

/** Props for {@link SessionPicker}. */
export interface SessionPickerProps {
  /** Seeds the filter box (e.g. text the user already typed). */
  readonly initialQuery?: string;
  /** Maximum sessions to fetch. Defaults to 50. */
  readonly pageSize?: number;
  /** Called with the chosen session on selection. */
  readonly onSelect: (session: Session) => void;
  /** Called when the user cancels (Esc / Ctrl+C). */
  readonly onCancel: () => void;
}

const PENDING_SUBJECT = "Auto-created session";

/**
 * Interactive picker for re-opening an existing session.
 *
 * Unlike agents, sessions are not search-indexed, so this composes
 * {@link useSessionList} with client-side text filtering over the recent
 * session list. The selected {@link Session} is returned via `onSelect`; use
 * `session.metadata.id` to resume it.
 *
 * @example
 * ```tsx
 * render(
 *   <InkStigmerProvider client={client}>
 *     <SessionPicker onSelect={(s) => resume(s.metadata?.id)} onCancel={() => process.exit(0)} />
 *   </InkStigmerProvider>,
 * );
 * ```
 */
export function SessionPicker({ initialQuery, pageSize = 50, onSelect, onCancel }: SessionPickerProps) {
  const { sessions, isLoading, error } = useSessionList({ pageSize });
  const [query, setQuery] = useState(initialQuery ?? "");

  const filtered = useMemo(() => filterSessions(sessions, query), [sessions, query]);
  const items = useMemo<PickerItem[]>(() => filtered.map(toSessionItem), [filtered]);

  const handleSelect = useCallback(
    (item: PickerItem) => {
      const found = sessions.find((s) => (s.metadata?.id ?? "") === item.id);
      if (found !== undefined) onSelect(found);
    },
    [sessions, onSelect],
  );

  return (
    <ResourcePicker
      prompt="Select a session"
      items={items}
      query={query}
      onQueryChange={setQuery}
      isLoading={isLoading}
      error={error}
      onSelect={handleSelect}
      onCancel={onCancel}
      emptyLabel="no sessions found"
    />
  );
}

/** Case-insensitive filter over a session's subject, agent, and id. */
function filterSessions(sessions: readonly Session[], query: string): readonly Session[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return sessions;
  return sessions.filter((s) => sessionHaystack(s).includes(needle));
}

function sessionHaystack(session: Session): string {
  return [sessionSubject(session), session.spec?.agentInstanceId ?? "", session.metadata?.id ?? ""]
    .join(" ")
    .toLowerCase();
}

/** Map a session to a picker row: subject title, agent subtitle, age meta. */
function toSessionItem(session: Session): PickerItem {
  return {
    id: session.metadata?.id ?? "",
    title: sessionSubject(session),
    subtitle: session.spec?.agentInstanceId ?? "",
    meta: relativeTime(session.status?.audit?.specAudit?.createdAt),
  };
}

// The session's display subject, suppressing the backend's auto-create
// sentinel (the async title activity replaces it shortly after creation).
function sessionSubject(session: Session): string {
  const subject = session.spec?.subject ?? "";
  if (subject !== "" && subject !== PENDING_SUBJECT) return subject;
  return session.metadata?.name !== undefined && session.metadata.name !== ""
    ? session.metadata.name
    : (session.metadata?.id ?? "(untitled session)");
}

// Coarse "N units ago" label from a protobuf Timestamp. Empty when unknown.
function relativeTime(ts: Timestamp | undefined): string {
  if (ts === undefined) return "";
  const then = Number(ts.seconds) * 1000;
  if (!Number.isFinite(then) || then <= 0) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  const units: ReadonlyArray<readonly [number, string]> = [
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, label] of units) {
    const value = Math.floor(seconds / size);
    if (value >= 1) return `${value} ${label}${value === 1 ? "" : "s"} ago`;
  }
  return "just now";
}
