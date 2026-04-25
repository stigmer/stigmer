"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  DESKTOP_PLATFORMS,
  DESKTOP_RELEASES_URL,
  SITE_CONFIG,
  fetchDesktopRelease,
  type DesktopPlatform,
  type DesktopRelease,
  type ResolvedDesktopPlatform,
} from "@/lib/constants";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SkipLink } from "@/components/ui/skip-link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

type DetectedOS = "macos" | "windows" | "linux" | null;

function useDetectOS(): DetectedOS {
  const [os, setOS] = React.useState<DetectedOS>(null);

  React.useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("mac")) setOS("macos");
    else if (ua.includes("win")) setOS("windows");
    else if (ua.includes("linux")) setOS("linux");
  }, []);

  return os;
}

function matchesPlatform(
  entry: DesktopPlatform,
  detectedOS: DetectedOS,
): boolean {
  if (!detectedOS) return false;
  if (entry.os !== detectedOS) return false;
  if (detectedOS === "linux") return entry.arch === "x64";
  return true;
}

// ---------------------------------------------------------------------------
// GitHub release resolution
// ---------------------------------------------------------------------------

interface ReleaseState {
  loading: boolean;
  release: DesktopRelease | null;
}

function useDesktopRelease(): ReleaseState {
  const [state, setState] = React.useState<ReleaseState>({
    loading: true,
    release: null,
  });

  React.useEffect(() => {
    let cancelled = false;
    fetchDesktopRelease().then((release) => {
      if (!cancelled) setState({ loading: false, release });
    });
    return () => { cancelled = true; };
  }, []);

  return state;
}

// ---------------------------------------------------------------------------
// Platform brand icons (inline SVGs — Lucide does not carry brand marks)
// ---------------------------------------------------------------------------

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11" />
    </svg>
  );
}

function WindowsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M3 12V6.5l8-1.1V12H3zm10 0V5.2L21 4v8h-8zM3 12.5h8v6.6l-8-1.1V12.5zm10 0h8v7.5l-8-1.2V12.5z" />
    </svg>
  );
}

function LinuxIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 0 0-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.368 1.884 1.43.868.07 1.723-.467 2.395-1.333.763-.982.537-1.963.063-3.27-.39-1.072-.49-2.272-.11-3.405.36-1.07.659-2.322.268-3.605-.26-.858-.683-1.392-1.09-1.81-.36-.37-.707-.697-.869-1.036l.001-.003c-.262-.593-.4-1.19-.386-1.723.014-.547.194-.958.608-1.258.523-.381 1.108-.405 1.478-.065a.555.555 0 0 0 .596.077c.18-.078.263-.262.227-.452-.063-.333-.356-.65-.787-.852-.487-.23-1.064-.296-1.589-.164-.577.144-1.063.545-1.328 1.14a3.1 3.1 0 0 0-.268 1.329c-.006.59.147 1.238.425 1.868.205.468.586.842.976 1.234.362.362.729.703.93 1.16.254.579.372 1.375.082 2.236-.357 1.063-.303 2.328.063 3.418l.003.005c.126.348.223.67.295.869a1.41 1.41 0 0 1-.017 1.013c-.238.415-.6.638-1.067.571-.518-.071-.99-.489-1.254-1.014a6.01 6.01 0 0 1-.033-.078c-.15-.35-.19-.667-.152-1.009a2.39 2.39 0 0 1 .056-.333c.098-.468.083-.938-.198-1.198-.178-.164-.446-.223-.738-.153-.292.066-.622.259-.898.648-.136.19-.26.396-.337.644a2.77 2.77 0 0 0-.097.39c-.125.766-.105 1.382-.189 1.873-.084.49-.195.762-.483 1.073-.574.621-1.283.808-1.893.666-.601-.14-1.095-.59-1.397-1.223-.075-.157-.15-.331-.223-.584-.062-.175-.094-.394-.094-.642 0-.314.076-.625.283-.915.157-.218.428-.399.719-.499l.005-.002c.392-.165.543-.307.698-.544.151-.235.26-.492.387-.788a.39.39 0 0 0-.006-.329c-.069-.133-.217-.228-.39-.271-.29-.07-.637-.007-.989.173-.349.18-.728.465-1.043.882-.269.358-.453.764-.533 1.149-.093.475-.082.912.02 1.289.16.563.396 1.022.534 1.314.19.39.298.728.298 1.05 0 .263-.055.485-.203.7-.322.471-.903.681-1.6.537-.735-.148-1.555-.594-2.327-1.098-.776-.508-1.478-1.043-2.046-1.465a3.52 3.52 0 0 0-.394-.287 1.63 1.63 0 0 1-.335-.212c-.085-.1-.115-.23-.1-.365.03-.27.158-.464.328-.591.17-.127.372-.192.584-.192.21 0 .42.075.608.153l.008.003c.283.121.515.316.756.447.244.132.508.2.793.149a.87.87 0 0 0 .428-.214c.095-.09.159-.197.159-.333-.001-.137-.06-.272-.16-.399-.102-.13-.234-.252-.413-.364a8.16 8.16 0 0 1-.563-.395c-.303-.239-.603-.49-.762-.836a1.07 1.07 0 0 1-.098-.449c0-.193.067-.385.193-.539.125-.151.304-.259.517-.324.213-.066.465-.083.713-.043a2.35 2.35 0 0 1 .747.281c.256.153.5.368.681.653.183.285.296.637.296 1.07 0 .478.113.83.353 1.122.24.293.58.488.971.588l.004.001c.176.046.299.152.399.327a.914.914 0 0 1 .127.465c0 .116-.028.227-.08.332" />
    </svg>
  );
}

function PlatformIcon({
  os,
  className,
}: {
  os: DesktopPlatform["os"];
  className?: string;
}) {
  switch (os) {
    case "macos":
      return <AppleIcon className={className} />;
    case "windows":
      return <WindowsIcon className={className} />;
    case "linux":
      return <LinuxIcon className={className} />;
  }
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

function DownloadPage() {
  const detectedOS = useDetectOS();
  const { loading, release } = useDesktopRelease();

  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        {/* Hero */}
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-4xl mx-auto">
            <FadeInUp>
              <div className="text-center mb-16">
                <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
                  Download
                </p>
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-6">
                  Stigmer Desktop
                </h1>
                <p className="text-lg text-muted-foreground max-w-xl mx-auto mb-6">
                  Run agents locally, manage runners from the system tray, and
                  launch sessions straight from your browser.
                </p>
                {release && (
                  <a
                    href={release.releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-border text-xs font-mono text-subtle hover:text-foreground transition-colors"
                  >
                    v{release.version}
                    <Icon
                      name="external-link"
                      size="xs"
                      className="opacity-50"
                    />
                  </a>
                )}
              </div>
            </FadeInUp>

            {/* Platform cards */}
            {release ? (
              <LivePlatformCards
                platforms={release.platforms}
                detectedOS={detectedOS}
              />
            ) : (
              <FallbackPlatformCards
                loading={loading}
                detectedOS={detectedOS}
              />
            )}

            <FadeInUp delay={0.3}>
              <div className="text-center mt-8">
                <a
                  href={DESKTOP_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  View all releases on GitHub
                  <Icon
                    name="external-link"
                    size="xs"
                    className="opacity-50"
                  />
                </a>
              </div>
            </FadeInUp>
          </div>
        </section>

        {/* After download */}
        <section className="pb-16 sm:pb-24 px-4">
          <div className="max-w-4xl mx-auto">
            <FadeInUp delay={0.4}>
              <div className="rounded-lg border border-border bg-card p-8 sm:p-10">
                <h2 className="text-xs font-mono uppercase tracking-wider text-subtle mb-6">
                  After you install
                </h2>
                <ul className="space-y-4">
                  <li>
                    <Link
                      href="/docs/guides/desktop/install"
                      className="group flex items-start gap-3"
                    >
                      <Icon
                        name="arrow-right"
                        size="sm"
                        className="text-subtle mt-0.5 transition-transform group-hover:translate-x-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-foreground group-hover:underline">
                          Install and set up
                        </span>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          First launch, signing in, and connecting to your
                          organization.
                        </p>
                      </div>
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/docs/guides/desktop/manage-runners"
                      className="group flex items-start gap-3"
                    >
                      <Icon
                        name="arrow-right"
                        size="sm"
                        className="text-subtle mt-0.5 transition-transform group-hover:translate-x-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-foreground group-hover:underline">
                          Manage runners
                        </span>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Start runners, launch sessions from the browser, and
                          use tray controls.
                        </p>
                      </div>
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/docs/guides/runners/local-runner"
                      className="group flex items-start gap-3"
                    >
                      <Icon
                        name="arrow-right"
                        size="sm"
                        className="text-subtle mt-0.5 transition-transform group-hover:translate-x-0.5"
                      />
                      <div>
                        <span className="text-sm font-medium text-foreground group-hover:underline">
                          Run from the CLI
                        </span>
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Use{" "}
                          <code className="text-xs font-mono px-1 py-0.5 rounded bg-muted">
                            stigmer up runner
                          </code>{" "}
                          for headless or Docker-based runners.
                        </p>
                      </div>
                    </Link>
                  </li>
                </ul>
              </div>
            </FadeInUp>
          </div>
        </section>

        {/* Open source note */}
        <section className="pb-16 sm:pb-24 px-4">
          <FadeInUp delay={0.5}>
            <div className="text-center">
              <p className="text-sm text-subtle">
                Stigmer Desktop is free and open source under the{" "}
                <a
                  href={`${SITE_CONFIG.githubUrl}/blob/main/LICENSE`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
                >
                  Apache 2.0 license
                </a>
                .
              </p>
            </div>
          </FadeInUp>
        </section>
      </main>

      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Platform card variants
// ---------------------------------------------------------------------------

function LivePlatformCards({
  platforms,
  detectedOS,
}: {
  platforms: ResolvedDesktopPlatform[];
  detectedOS: DetectedOS;
}) {
  return (
    <StaggerContainer
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border"
      staggerDelay={0.08}
      delayChildren={0.1}
    >
      {platforms.map((entry) => {
        const isRecommended = matchesPlatform(entry, detectedOS);

        return (
          <StaggerItem key={`${entry.os}-${entry.arch}`}>
            <div
              className={cn(
                "bg-background p-6 sm:p-8 h-full flex flex-col items-center text-center",
                isRecommended && "bg-card",
              )}
            >
              {isRecommended && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                  Recommended
                </span>
              )}

              <PlatformIcon
                os={entry.os}
                className="w-8 h-8 text-foreground mb-4"
              />

              <h2 className="text-sm font-medium text-foreground mb-0.5">
                {entry.label}
              </h2>
              <p className="text-xs text-subtle mb-5">
                {entry.archLabel}
              </p>

              <Button
                asChild
                variant={isRecommended ? "default" : "outline"}
                size="sm"
                className="w-full max-w-[180px]"
              >
                <a href={entry.downloadUrl}>
                  <Icon name="download" size="sm" />
                  Download {entry.fileExt}
                </a>
              </Button>
            </div>
          </StaggerItem>
        );
      })}
    </StaggerContainer>
  );
}

function FallbackPlatformCards({
  loading,
  detectedOS,
}: {
  loading: boolean;
  detectedOS: DetectedOS;
}) {
  return (
    <StaggerContainer
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border"
      staggerDelay={0.08}
      delayChildren={0.1}
    >
      {DESKTOP_PLATFORMS.map((entry) => {
        const isRecommended = matchesPlatform(entry, detectedOS);

        return (
          <StaggerItem key={`${entry.os}-${entry.arch}`}>
            <div
              className={cn(
                "bg-background p-6 sm:p-8 h-full flex flex-col items-center text-center",
                isRecommended && "bg-card",
              )}
            >
              {isRecommended && (
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-3">
                  Recommended
                </span>
              )}

              <PlatformIcon
                os={entry.os}
                className="w-8 h-8 text-foreground mb-4"
              />

              <h2 className="text-sm font-medium text-foreground mb-0.5">
                {entry.label}
              </h2>
              <p className="text-xs text-subtle mb-5">
                {entry.archLabel}
              </p>

              <Button
                variant={isRecommended ? "default" : "outline"}
                size="sm"
                className="w-full max-w-[180px]"
                disabled
              >
                <Icon name="download" size="sm" />
                {loading ? "Loading\u2026" : "Unavailable"}
              </Button>
            </div>
          </StaggerItem>
        );
      })}
    </StaggerContainer>
  );
}

export { DownloadPage };
