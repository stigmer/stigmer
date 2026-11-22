/**
 * The Releases page: every published release, newest first, with the
 * Highlights and the upgrade notes its release notes carry and a link to the
 * full notes on GitHub.
 *
 * The words are the release notes themselves, read when the site builds
 * (lib/releases.ts), so nobody writes a second copy; a build that cannot read
 * them fails. Each release is a rail (version and date, held in view while
 * its words scroll at desktop widths) beside its words at reading width; on a
 * phone the rail is one line above them. The release that opens a minor line
 * is set larger than a patch, and the upgrade notes stay folded until asked
 * for, under a line that says how many there are.
 */
import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { pageMetadata } from "@/lib/page-metadata";
import { INLINE_CODE, renderReleaseNotes } from "@/lib/release-notes";
import { loadReleases, upgradeNoteCount } from "@/lib/releases";
import { cn } from "@/lib/utils";

const DESCRIPTION = `What's new in each version of ${SITE_CONFIG.name}, and what to know before you upgrade.`;

export const metadata: Metadata = pageMetadata({
  title: "Releases",
  description: DESCRIPTION,
  path: "/releases",
});

/** The line that opens a release's upgrade notes. */
function upgradeSummary(upgrading: string): string {
  const count = upgradeNoteCount(upgrading);
  if (count === 0) return "What to know before you upgrade";
  return count === 1 ? "1 thing to know before you upgrade" : `${count} things to know before you upgrade`;
}

/** The day a release was published, in UTC so every build prints the same day. */
function publishedOn(publishedAt: string): string {
  return new Date(publishedAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default async function ReleasesPage() {
  const releases = await loadReleases();
  const entries = await Promise.all(
    releases.map(async (release) => ({
      release,
      highlights: release.highlights === null ? null : await renderReleaseNotes(release.highlights),
      upgrading: release.upgrading === null ? null : await renderReleaseNotes(release.upgrading),
    })),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-10 sm:px-6 md:pb-24 md:pt-16 lg:px-8">
      <h1 className="text-3xl font-display font-bold tracking-tight">Releases</h1>
      <p className="mt-2 max-w-[38rem] text-muted-foreground">{DESCRIPTION}</p>
      <p className="mt-7 max-w-[44rem] rounded border border-border bg-card px-4 py-3.5 text-sm leading-relaxed text-muted-foreground">
        <span className="font-medium text-foreground">On an earlier version?</span> Run{" "}
        <code className={INLINE_CODE}>npm install -g @stigmer/cli</code> again, or{" "}
        <code className={INLINE_CODE}>brew upgrade stigmer</code> (Homebrew follows about a day after a
        release), then <code className={INLINE_CODE}>stigmer up</code>. The latest is {releases[0].version}.
      </p>

      <div className="mt-14 flex flex-col">
        {entries.map(({ release, highlights, upgrading }, index) => (
          <article
            key={release.tag}
            id={release.tag}
            className="grid scroll-mt-16 grid-cols-1 gap-4 border-t border-border py-8 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-x-8 md:gap-y-2 md:py-10"
          >
            <header className="flex items-baseline justify-between gap-3 md:sticky md:top-24 md:flex-col md:items-start md:justify-start md:gap-1.5 md:self-start">
              <h2
                className={cn(
                  "flex items-center gap-2.5 font-display font-semibold leading-[1.1] tracking-tight tabular-nums",
                  release.minor ? "text-[1.75rem]" : "text-xl text-muted-foreground",
                )}
              >
                <a href={`#${release.tag}`}>{release.version}</a>
                {index === 0 && (
                  <span className="rounded-full border border-subtle px-2 py-0.5 font-sans text-[11px] font-medium uppercase leading-normal tracking-wider text-foreground">
                    Latest
                  </span>
                )}
              </h2>
              <time
                dateTime={release.publishedAt}
                className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
              >
                {publishedOn(release.publishedAt)}
              </time>
            </header>

            <div className="flex min-w-0 max-w-[40rem] flex-col gap-5">
              {highlights !== null && (
                <div className="flex flex-col gap-3.5 text-[15px] leading-relaxed text-muted-foreground [&>ol]:mt-0 [&>ul]:mt-0">
                  {highlights}
                </div>
              )}
              {release.upgrading !== null && (
                <details className="group rounded border border-border">
                  <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded px-3.5 py-2.5 text-sm font-medium hover:bg-card [&::-webkit-details-marker]:hidden">
                    <span
                      aria-hidden="true"
                      className="size-[7px] flex-none -rotate-45 border-b-[1.5px] border-r-[1.5px] border-muted-foreground transition-transform group-open:rotate-45 motion-reduce:transition-none"
                    />
                    {upgradeSummary(release.upgrading)}
                  </summary>
                  <div className="border-t border-border px-3.5 pb-3.5 pt-1 text-sm leading-relaxed text-muted-foreground [&>p]:mt-2.5 [&>pre]:mt-2.5">
                    {upgrading}
                  </div>
                </details>
              )}
              <a
                href={release.url}
                className="self-start text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Full release notes on GitHub <span aria-hidden="true">→</span>
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
