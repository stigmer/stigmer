/**
 * Why we built Stigmer: the agent machinery started inside Planton, the
 * DevOps product the same team builds, and left it to become its own
 * open-source product.
 *
 * Every sentence restates a fact from the dated post this page links
 * (blog/how-we-put-agents-into-planton.mdx), which stays the long version.
 * The page prints no figure apart from its dates: nothing counts the
 * assistant's use yet, and a measured result joins "Where it is today" with
 * its source when one exists.
 */
import * as React from "react";
import Link from "next/link";
import { SITE_CONFIG } from "@/lib/constants";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SkipLink } from "@/components/ui/skip-link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp } from "@/components/ui/motion";

const inlineLink = "text-foreground underline underline-offset-4 hover:text-foreground/80";

/** What Planton writes for its agent, beside what Stigmer runs for it. */
const SPLIT = [
  { label: "Planton writes", items: ["Its tools", "Its skill", "Its agent's instructions"] },
  {
    label: "Stigmer runs",
    items: ["Where each agent works", "Asking before it acts", "The walls between customers"],
  },
] as const;

interface PartProps {
  id: string;
  when: string;
  title: string;
  children: React.ReactNode;
}

/** One part of the story: when it happened beside what happened. */
function Part({ id, when, title, children }: PartProps) {
  return (
    <section className="py-12 px-4 border-t border-border" aria-labelledby={id}>
      <div className="max-w-4xl mx-auto">
        <FadeInUp className="grid gap-2 sm:grid-cols-[10rem_1fr] sm:gap-10">
          <p className="text-xs font-mono uppercase tracking-wider text-subtle sm:pt-2">{when}</p>
          <div className="min-w-0">
            <h2 id={id} className="text-2xl font-bold text-foreground mb-4">
              {title}
            </h2>
            <div className="space-y-4 text-muted-foreground leading-relaxed">{children}</div>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-4xl mx-auto">
            <FadeInUp>
              <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">About</p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-6">
                Why we built Stigmer
              </h1>
              <p className="text-lg text-muted-foreground leading-relaxed max-w-2xl">
                We also build Planton, a DevOps product. Its customers wanted to ask for a change to
                their cloud setup, like &ldquo;make staging match production&rdquo;, instead of
                hunting for the right screen. Stigmer is what we built to give them that.
              </p>
            </FadeInUp>
          </div>
        </section>

        <Part id="tried-first-heading" when="First try" title="What we tried first">
          <p>
            Our first try lived inside Planton: a Copilot, a chat in the console with our own
            services behind it to run agents.
          </p>
          <p>
            It taught us two things. An assistant that only answers questions isn&apos;t worth
            shipping: people wanted the change made, and being told which screen to open
            didn&apos;t help. And an agent that does real work needs a lot underneath it: somewhere
            to run, a way to ask before it acts, and walls between one customer and the next. That
            is a product of its own, and we were building it as a corner of another one.
          </p>
        </Part>

        <Part id="built-instead-heading" when="April 2026" title="What we built instead">
          <p>
            We took that machinery out of Planton and built it once, on its own, as open source.
            That is Stigmer. Planton calls it the way it calls its database: it asks Stigmer for an
            agent and a conversation, and Stigmer runs it. Planton runs on Stigmer Cloud, the
            version we host, and the chat in Planton&apos;s console and desktop app is
            Stigmer&apos;s own React components, placed inside Planton&apos;s screens.
          </p>
          <dl className="grid sm:grid-cols-2 gap-px bg-border border border-border rounded-lg overflow-hidden">
            {SPLIT.map((side) => (
              <div key={side.label} className="bg-background p-5">
                <dt className="text-xs font-mono uppercase tracking-wider text-subtle mb-3">
                  {side.label}
                </dt>
                {side.items.map((item) => (
                  <dd key={item} className="text-foreground py-0.5">
                    {item}
                  </dd>
                ))}
              </div>
            ))}
          </dl>
          <p>
            Each Planton organization gets its own organization inside Stigmer, so one
            customer&apos;s agent never sees another customer&apos;s conversations or files.
            Keeping them apart is Stigmer&apos;s job, not code Planton wrote.{" "}
            <Link href="/docs/getting-started/one-organization-per-customer" className={inlineLink}>
              Give each customer their own organization
            </Link>{" "}
            shows how to do the same in your product.
          </p>
        </Part>

        <Part id="today-heading" when="Today" title="Where it is today">
          <p>
            The Planton Assistant moved to Stigmer Cloud in August 2026, and each Planton
            organization got its own space later that month. It is switched on for our own team
            first, and it reaches Planton&apos;s customers as Planton rolls it out.
          </p>
          <p>
            Nothing counts its use yet, so this page has no numbers. When there are measured
            results, they will be here, with where they came from.
          </p>
        </Part>

        <section className="py-16 px-4 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <FadeInUp>
              <p className="text-muted-foreground leading-relaxed mb-8">
                The whole story, with what Planton&apos;s agent does and how it asks first:{" "}
                <Link href="/blog/how-we-put-agents-into-planton" className={inlineLink}>
                  How we put agents into Planton
                </Link>
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
      </main>

      <Footer />
    </div>
  );
}

export { AboutPage };
