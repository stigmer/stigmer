"use client";

import * as React from "react";
import Link from "next/link";
import { SITE_CONFIG } from "@/lib/constants";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SkipLink } from "@/components/ui/skip-link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp } from "@/components/ui/motion";

/**
 * Anthropic's pages every Claude Managed Agents fact here comes from, and the
 * day they were read. Nothing is said about Managed Agents that these pages
 * do not say; re-read them, and move the date, when a fact is changed.
 */
export const ANTHROPIC_SOURCES = {
  overview: {
    label: "Managed Agents overview",
    href: "https://platform.claude.com/docs/en/managed-agents/overview",
  },
  reference: {
    label: "Managed Agents reference",
    href: "https://platform.claude.com/docs/en/managed-agents/reference",
  },
} as const;

export const SOURCES_READ_ON = "21 October 2026";

type SourceKey = keyof typeof ANTHROPIC_SOURCES;

const inlineLink = "text-foreground underline underline-offset-4 hover:text-foreground/80";

/** One question both sides' docs answer, with each side's answer. */
const ROWS: readonly {
  question: string;
  managedAgents: React.ReactNode;
  source: SourceKey;
  stigmer: React.ReactNode;
}[] = [
  {
    question: "Who runs it and keeps the session history",
    managedAgents:
      "Anthropic. Sessions store conversation history, sandbox state and outputs server-side.",
    source: "overview",
    stigmer:
      "Whoever runs Stigmer: you, on your own servers, or us, on Stigmer Cloud. The history is kept in that server's database.",
  },
  {
    question: "Where the agent's computer runs",
    managedAgents:
      "An Anthropic-managed cloud sandbox, or a self-hosted sandbox on your own infrastructure.",
    source: "overview",
    stigmer: (
      <>
        A sandbox on your servers (a local process, Docker or Kubernetes), or a managed sandbox
        on Stigmer Cloud.{" "}
        <Link href="/docs/concepts/environments" className={inlineLink}>
          Environments
        </Link>
      </>
    ),
  },
  {
    question: "Models",
    managedAgents: "Claude.",
    source: "overview",
    stigmer: (
      <>
        Your own keys: Anthropic on your servers; Anthropic, OpenAI or a compatible endpoint on
        Stigmer Cloud.{" "}
        <Link href="/docs/guides/self-hosting/cloud-vs-self-hosted" className={inlineLink}>
          The editions
        </Link>
      </>
    ),
  },
  {
    question: "Asking before acting",
    managedAgents: (
      <>
        Permission policies on tools: a <code className="font-mono">user.tool_confirmation</code>{" "}
        event approves or denies a call a policy holds for confirmation.
      </>
    ),
    source: "reference",
    stigmer: (
      <>
        Approval flows: it asks before shell commands, file writes and deletes, and the MCP
        tools their server marks destructive; hooks change that call by call.{" "}
        <Link href="/docs/concepts/approval-flows" className={inlineLink}>
          Approval flows
        </Link>
      </>
    ),
  },
  {
    question: "The session events API",
    managedAgents: "Its own: user, agent and session events, sent and streamed over HTTP.",
    source: "reference",
    stigmer: (
      <>
        Managed Agents&apos; session events, listed, streamed and sent on its own paths, so
        Anthropic&apos;s SDK reads and answers a Stigmer session, tested on every change. The
        docs list where they differ.{" "}
        <Link href="/docs/sdk/managed-agents" className={inlineLink}>
          Use Anthropic&apos;s SDK
        </Link>
      </>
    ),
  },
];

/** What Stigmer does that the comparison above has no row for. */
const FURTHER: readonly { text: string; cta: string; href: string; external?: boolean }[] = [
  {
    text: "An Apache 2.0 core you can read, change and run.",
    cta: "The source",
    href: SITE_CONFIG.githubUrl,
    external: true,
  },
  {
    text: "The whole server on your own machines: the control plane and the session history as well as the agent's computer.",
    cta: "Self-hosting",
    href: "/docs/guides/self-hosting/overview",
  },
  {
    text: "An organization per customer, on the editions that include it.",
    cta: "Give each customer their own organization",
    href: "/docs/getting-started/one-organization-per-customer",
  },
  {
    text: "A choice of harness for each session: Stigmer's own, or Anthropic's Claude Agent SDK.",
    cta: "Harnesses",
    href: "/docs/concepts/harnesses",
  },
];

function SourceLink({ source }: { source: SourceKey }) {
  const { label, href } = ANTHROPIC_SOURCES[source];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-1 text-xs font-mono text-subtle underline underline-offset-4 hover:text-muted-foreground"
    >
      {label}
    </a>
  );
}

function CompareManagedAgentsPage() {
  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-4xl mx-auto">
            <FadeInUp>
              <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4 text-center">
                Compare
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-10 text-center">
                Stigmer and Claude Managed Agents
              </h1>
              <dl className="grid gap-6 sm:grid-cols-2">
                <div className="rounded-lg border border-border p-6">
                  <dt className="text-xs font-mono uppercase tracking-wider text-subtle mb-3">
                    Claude Managed Agents
                  </dt>
                  <dd className="text-muted-foreground leading-relaxed">
                    Anthropic&apos;s &ldquo;pre-built, configurable agent harness that runs in
                    managed infrastructure&rdquo;.
                    <SourceLink source="overview" />
                  </dd>
                </div>
                <div className="rounded-lg border border-border p-6">
                  <dt className="text-xs font-mono uppercase tracking-wider text-subtle mb-3">
                    Stigmer
                  </dt>
                  <dd className="text-muted-foreground leading-relaxed">{SITE_CONFIG.subhead}</dd>
                </div>
              </dl>
            </FadeInUp>
          </div>
        </section>

        <section className="pb-16 px-4" aria-labelledby="side-by-side-heading">
          <div className="max-w-5xl mx-auto">
            <FadeInUp>
              <h2 id="side-by-side-heading" className="text-2xl font-bold text-foreground mb-6">
                Side by side
              </h2>
              <div role="table" aria-labelledby="side-by-side-heading" className="text-sm">
                <div
                  role="row"
                  className="hidden md:grid md:grid-cols-[1fr_1.5fr_1.5fr] gap-6 py-3 border-b border-border"
                >
                  {["", "Claude Managed Agents", "Stigmer"].map((label) => (
                    <div
                      key={label}
                      role="columnheader"
                      className="text-xs font-mono uppercase tracking-wider text-subtle"
                    >
                      {label}
                    </div>
                  ))}
                </div>
                {ROWS.map((row) => (
                  <div
                    key={row.question}
                    role="row"
                    className="grid gap-3 md:grid-cols-[1fr_1.5fr_1.5fr] md:gap-6 py-5 border-b border-border"
                  >
                    <div role="rowheader" className="font-semibold text-foreground">
                      {row.question}
                    </div>
                    <div role="cell" className="text-muted-foreground leading-relaxed">
                      <span className="md:hidden block text-xs font-mono uppercase tracking-wider text-subtle mb-1">
                        Claude Managed Agents
                      </span>
                      {row.managedAgents}
                      <SourceLink source={row.source} />
                    </div>
                    <div role="cell" className="text-muted-foreground leading-relaxed">
                      <span className="md:hidden block text-xs font-mono uppercase tracking-wider text-subtle mb-1">
                        Stigmer
                      </span>
                      {row.stigmer}
                    </div>
                  </div>
                ))}
              </div>
            </FadeInUp>
          </div>
        </section>

        <section className="py-16 px-4 border-t border-border" aria-labelledby="further-heading">
          <div className="max-w-4xl mx-auto">
            <FadeInUp>
              <h2 id="further-heading" className="text-2xl font-bold text-foreground mb-6">
                Where Stigmer goes further
              </h2>
              <ul className="space-y-4">
                {FURTHER.map((item) => (
                  <li key={item.text} className="text-muted-foreground leading-relaxed">
                    {item.text}{" "}
                    {item.external ? (
                      <a href={item.href} target="_blank" rel="noopener noreferrer" className={inlineLink}>
                        {item.cta}
                      </a>
                    ) : (
                      <Link href={item.href} className={inlineLink}>
                        {item.cta}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </FadeInUp>
          </div>
        </section>

        <section className="py-16 px-4 border-t border-border" aria-labelledby="which-fits-heading">
          <div className="max-w-4xl mx-auto">
            <FadeInUp>
              <h2 id="which-fits-heading" className="text-2xl font-bold text-foreground mb-6">
                Which fits
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                Claude Managed Agents, if you want Anthropic to run all of it, on Claude.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Stigmer, if you want to run the whole of it yourself, choose the harness, or give
                each customer their own organization.
              </p>
            </FadeInUp>
          </div>
        </section>

        <section className="py-16 px-4 border-t border-border" aria-labelledby="already-heading">
          <div className="max-w-4xl mx-auto">
            <FadeInUp>
              <h2 id="already-heading" className="text-2xl font-bold text-foreground mb-6">
                Already on Managed Agents?
              </h2>
              <p className="text-muted-foreground leading-relaxed mb-8">
                <Link href="/docs/concepts/coming-from-claude-managed-agents" className={inlineLink}>
                  Coming from Claude Managed Agents
                </Link>{" "}
                maps each Managed Agents idea to its Stigmer counterpart, and says where there is
                none. Code that reads a session&apos;s events with Anthropic&apos;s SDK reads a
                Stigmer session the same way:{" "}
                <Link href="/docs/sdk/managed-agents" className={inlineLink}>
                  Use Anthropic&apos;s SDK
                </Link>{" "}
                says how.
              </p>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3">
                <Button asChild size="lg">
                  <Link href="/docs/getting-started/quickstart">
                    Run the quickstart
                    <Icon name="arrow-right" size="sm" />
                  </Link>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <a href={SITE_CONFIG.cloudSignupUrl}>Start free</a>
                </Button>
              </div>
            </FadeInUp>
          </div>
        </section>

        <section className="py-10 px-4 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <p className="text-xs text-subtle leading-relaxed">
              What this page says about Claude Managed Agents comes from Anthropic&apos;s
              documentation, read on {SOURCES_READ_ON}:{" "}
              {Object.values(ANTHROPIC_SOURCES).map((source, index) => (
                <React.Fragment key={source.href}>
                  {index > 0 && " and "}
                  <a
                    href={source.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-muted-foreground"
                  >
                    {source.label}
                  </a>
                </React.Fragment>
              ))}
              . Managed Agents is in beta, and it may have changed since. Claude and Claude Managed
              Agents are Anthropic&apos;s products.
            </p>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export { CompareManagedAgentsPage };
