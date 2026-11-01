/**
 * The sandbox's proof: how long a sleeping agent takes to be working again,
 * as measured on Stigmer Cloud, with the date and a link to the method.
 *
 * The wait a person sees leads, for an agent woken where it slept and one
 * whose files came back from storage, each with the part spent waking the
 * sandbox beside it, its p95 and how many wakes it counts; a new
 * conversation's first turn follows on its own line. Every figure is read
 * from brand/measurements.ts and printed by `formatSeconds`, so this file
 * holds no figure of its own (brand/__tests__/measurements.test.ts refuses
 * one).
 */
import Link from "next/link";
import {
  SANDBOX_WAKE,
  SANDBOX_WAKE_METHOD_HREF,
  formatSeconds,
  type WakePathName,
} from "../../../../../brand/measurements";
import { formatDate } from "@/lib/utils";

const LEADING: readonly { path: WakePathName; label: string }[] = [
  { path: "node", label: "Woken where it slept" },
  { path: "storage", label: "Woken from storage" },
];

export function WakeProof() {
  const fresh = SANDBOX_WAKE.paths.new;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-mono uppercase tracking-wider text-subtle">
        From a new message to a sleeping agent working again
      </p>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {LEADING.map(({ path, label }) => {
          const { n, working, resume } = SANDBOX_WAKE.paths[path];
          return (
            <div key={path} className="flex flex-col gap-1 border-t border-border pt-3">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="flex flex-col gap-1">
                <span className="text-4xl font-semibold tracking-tight text-foreground tabular-nums">
                  {formatSeconds(working.p50)}
                </span>
                <span className="flex flex-col text-xs font-mono text-subtle leading-relaxed">
                  <span>{formatSeconds(resume.p50)} of it waking the sandbox</span>
                  <span>
                    p95 {formatSeconds(working.p95)} · {n} wakes
                  </span>
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="text-sm text-muted-foreground tabular-nums">
        A new conversation&apos;s first turn, its sandbox created: {formatSeconds(fresh.working.p50)} ({fresh.n}{" "}
        conversations)
      </p>
      <p className="text-xs font-mono text-subtle">
        {SANDBOX_WAKE.environment} · {formatDate(SANDBOX_WAKE.measuredOn)} ·{" "}
        <Link href={SANDBOX_WAKE_METHOD_HREF} className="text-foreground underline underline-offset-4 hover:text-foreground/80">
          How we measured
        </Link>
      </p>
    </div>
  );
}
