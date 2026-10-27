/**
 * The public pricing page: what it costs to use Stigmer in each of its three
 * editions. Stigmer Cloud's four flat plans come first; under them, the two
 * ways to run it yourself, open source at no cost and Stigmer Enterprise on
 * an annual license. One rule holds in all three: Stigmer runs no model of
 * its own, so agents run on the customer's own provider keys, the provider
 * bills every token, and Stigmer charges only for the platform.
 *
 * A plan feature and a plan's terms (its child organizations, agent hours
 * and agents at once) are worded by @stigmer/react-sdk's plan vocabulary,
 * the words the console's plan cards use, and Free and Enterprise Cloud are
 * rendered from the console's own descriptions of them, so a visitor reads
 * the same words before and after signing up. Team's and Business's fees and
 * numbers are the Cloud's launch terms, hand-kept: the catalog needs a
 * sign-in and this page is static, so a new version of those terms updates
 * them here too. Nothing is fetched: there is no price list to load because
 * no token is priced.
 */
import * as React from "react";
import Link from "next/link";
import { create } from "@bufbuild/protobuf";
import { PlanTermsSchema, type PlanTerms } from "@stigmer/apis/ai/stigmer/billing/plan/v1/spec_pb";
import { EntitlementsSchema, Feature, type Entitlements } from "@stigmer/apis/ai/stigmer/platform/v1/entitlement_pb";
import {
  ENTERPRISE_CLOUD_PLAN,
  FEATURE_COPY,
  FREE_PLAN,
  offeredFeatures,
  planTermLines,
  type NamedFeature,
} from "@stigmer/react-sdk";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SkipLink } from "@/components/ui/skip-link";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp, StaggerContainer, StaggerItem } from "@/components/ui/motion";

type Plan = {
  id: string;
  name: string;
  /** The fee as shown, e.g. "$99"; "Custom" for a quoted plan. */
  price: string;
  /** Shown after the fee for a monthly plan. */
  period?: string;
  description: string;
  /** The plan below whose features this one includes, e.g. "Everything in Team". */
  includes?: string;
  /**
   * What the plan adds: a feature the contract names, in the console's
   * words, or a term the catalog states that is not a feature.
   */
  features: readonly (NamedFeature | string)[];
  /**
   * A Cloud plan's terms beyond its features, listed after them in the
   * console's words: its child organizations, agent hours and agents at once.
   */
  terms?: { entitlements: Entitlements; terms?: PlanTerms };
  cta: { label: string; href: string; internal?: boolean };
  featured?: boolean;
};

// Money in micro-USD, as the catalog holds it. BigInt(…), not a literal:
// the site compiles for a target with no BigInt literal syntax.
const USD = BigInt(1_000_000);
const PER_AGENT_HOUR = (USD * BigInt(4)) / BigInt(10);

const CLOUD_PLANS: readonly Plan[] = [
  {
    id: "free",
    name: FREE_PLAN.name,
    price: "$0",
    period: "/month",
    description: "Build agents and put them in front of people.",
    features: [...offeredFeatures(FREE_PLAN.entitlements).map((offered) => offered.feature), ...FREE_PLAN.extras],
    terms: { entitlements: FREE_PLAN.entitlements },
    cta: { label: "Start free", href: SITE_CONFIG.cloudSignupUrl },
  },
  {
    id: "team",
    name: "Team",
    price: "$99",
    period: "/month",
    description: "Organize your members and grant access by team.",
    includes: "Everything in Free",
    features: [Feature.teams],
    terms: {
      entitlements: create(EntitlementsSchema, {
        features: [Feature.teams],
        limits: { includedAgentHours: 300, maxActiveSessionSandboxes: 25 },
      }),
      terms: create(PlanTermsSchema, { perAgentHourMicros: PER_AGENT_HOUR }),
    },
    cta: { label: "Get Started", href: SITE_CONFIG.cloudSignupUrl },
    featured: true,
  },
  {
    id: "business",
    name: "Business",
    price: "$499",
    period: "/month",
    description:
      "Run organizations for your own customers under yours, on one pool of hours and agents.",
    includes: "Everything in Team",
    features: [Feature.child_orgs],
    terms: {
      entitlements: create(EntitlementsSchema, {
        features: [Feature.child_orgs],
        limits: {
          includedChildOrgs: 5,
          includedAgentHours: 1500,
          maxActiveSessionSandboxes: 100,
        },
      }),
      terms: create(PlanTermsSchema, {
        perExtraOrgMicros: USD * BigInt(25),
        perAgentHourMicros: PER_AGENT_HOUR,
      }),
    },
    cta: { label: "Get Started", href: SITE_CONFIG.cloudSignupUrl },
  },
  {
    id: "enterprise-cloud",
    name: ENTERPRISE_CLOUD_PLAN.name,
    price: "Custom",
    description: "Quoted for your organization.",
    includes: ENTERPRISE_CLOUD_PLAN.includes,
    features: [...ENTERPRISE_CLOUD_PLAN.features, ENTERPRISE_CLOUD_PLAN.terms],
    cta: {
      label: "Contact Sales",
      href: SITE_CONFIG.contactSalesUrl,
      internal: true,
    },
  },
];

// What each self-hosted edition is, from its own documentation (the Helm
// chart's README and ee/server/README.md). These come with the edition
// rather than from a plan's or a license's feature list, so they are
// written here rather than named through the plan vocabulary.
const SELF_HOSTED_PLANS: readonly Plan[] = [
  {
    id: "open-source",
    name: "Stigmer open source",
    price: "$0",
    description: "Apache 2.0. Run the whole engine on your own machines.",
    features: [
      "The full engine: agents, skills, sessions, MCP servers",
      "One organization, with sign-in and roles",
      "A laptop, one server or Kubernetes",
    ],
    cta: {
      label: "Self-host",
      href: "/docs/guides/self-hosting/overview",
      internal: true,
    },
  },
  {
    id: "enterprise",
    name: "Stigmer Enterprise",
    price: "Custom",
    description: "Annual license, quoted for your organization.",
    features: [
      "Many organizations",
      "Teams and invitations",
      "Federation with the identity providers you trust",
      "Access history",
      "Runs on your infrastructure; a license key unlocks it",
    ],
    cta: {
      label: "Contact Sales",
      href: SITE_CONFIG.contactSalesUrl,
      internal: true,
    },
  },
];

type FaqItem = {
  q: string;
  a: string;
  /** Optional deep link rendered after the answer. */
  link?: { href: string; label: string };
};

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: "Do you charge for tokens?",
    a: "No. A plan's price is its monthly fee, plus the agent hours past its allowance on a paid plan, and Stigmer never adds anything to a model call. Your token usage is still counted, so you can see it per run, session, agent and organization in the console and the CLI.",
    link: {
      href: "/docs/concepts/billing#see-your-usage",
      label: "See your usage",
    },
  },
  {
    q: "Whose model keys do my agents use?",
    a: "Your own. Stigmer runs no model of its own, so add a key before your first run. An admin adds your organization's Anthropic or OpenAI key, a compatible endpoint, or a Cursor key in the console, and every model call runs on it, on every plan. Your provider bills those calls to you directly.",
    link: {
      href: "/docs/guides/integrations/model-provider-keys",
      label: "Model provider keys",
    },
  },
  {
    q: "How are plans billed?",
    a: "A paid plan is invoiced through Stripe at the end of each monthly period and charged to the card on file, with tax added where it applies. Changing plans takes effect at once and is prorated; canceling keeps your plan until the end of the period you paid for. On Business, each child organization past the five included adds $25 a month.",
  },
  {
    q: "What is an agent hour?",
    a: "The time an agent spends working on a task. It is counted only while the agent works: time spent waiting for a person to reply is never counted. Each plan includes agent hours every month. On Free, new work pauses once the month's hours are used, until the next month starts; a plan with an hourly price never pauses and bills the hours past its allowance on its invoice.",
    link: {
      href: "/docs/concepts/billing#agent-hours",
      label: "Agent hours",
    },
  },
  {
    q: 'What does "agents at once" mean?',
    a: "How many of your organization's conversations can have an agent awake at the same time. An agent stays awake while it works and for a short while after, then sleeps until the next message. At the limit, a new conversation, or a message to one whose agent is asleep, waits for room: it can start once another conversation goes idle or is deleted. A message to a conversation whose agent is awake is never held back by this number. A child organization shares its parent's number.",
    link: {
      href: "/docs/concepts/billing#agents-at-once",
      label: "Agents at once",
    },
  },
  {
    q: "Can I self-host for free?",
    a: "Yes. Stigmer comes in three editions: Stigmer open source, free under Apache 2.0, which you run yourself; Stigmer Enterprise, which you also run yourself, on an annual license whose key turns on many organizations, teams and federation; and Stigmer Cloud, which we run for you on the plans above. Self-host anywhere — there is no vendor lock-in. Cloud plans only apply when you use Stigmer Cloud (app.stigmer.ai).",
    link: {
      href: "/docs/guides/self-hosting/cloud-vs-self-hosted",
      label: "Compare the three editions",
    },
  },
];

function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        {/* Hero */}
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-4xl mx-auto text-center">
            <FadeInUp>
              <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
                Pricing
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-6">
                Pay for the platform, not the tokens.
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Every Stigmer Cloud plan is a flat monthly fee with agent hours
                included. Stigmer runs no
                model of its own: your agents run on your own model provider
                keys, so your provider bills every token directly and Stigmer
                adds nothing to it.
              </p>
            </FadeInUp>
          </div>
        </section>

        {/* Stigmer Cloud */}
        <section className="py-12 sm:py-16 px-4">
          <div className="max-w-6xl mx-auto">
            <FadeInUp>
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                  Stigmer Cloud
                </h2>
                <p className="text-sm text-muted-foreground">
                  Every organization starts on Free, and every plan runs on
                  your own model keys.
                </p>
              </div>
            </FadeInUp>

            <StaggerContainer
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden border border-border"
              staggerDelay={0.1}
              delayChildren={0.1}
            >
              {CLOUD_PLANS.map((plan) => (
                <StaggerItem key={plan.id}>
                  <PlanCard plan={plan} />
                </StaggerItem>
              ))}
            </StaggerContainer>

            <FadeInUp delay={0.3}>
              <div className="text-center mt-8">
                <p className="text-sm text-subtle max-w-2xl mx-auto">
                  Models run on your own provider keys, and your provider
                  bills you directly. Stigmer never charges for tokens.
                </p>
              </div>
            </FadeInUp>
          </div>
        </section>

        {/* Run it yourself */}
        <section className="py-12 sm:py-16 px-4">
          <div className="max-w-3xl mx-auto">
            <FadeInUp>
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                  Run it yourself
                </h2>
                <p className="text-sm text-muted-foreground">
                  The same platform on your own infrastructure, with your
                  agents on your own model keys.
                </p>
              </div>
            </FadeInUp>

            <StaggerContainer
              className="grid grid-cols-1 md:grid-cols-2 gap-px bg-border rounded-lg overflow-hidden border border-border"
              staggerDelay={0.1}
              delayChildren={0.1}
            >
              {SELF_HOSTED_PLANS.map((plan) => (
                <StaggerItem key={plan.id}>
                  <PlanCard plan={plan} />
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-12 sm:py-16 px-4">
          <div className="max-w-3xl mx-auto">
            <FadeInUp>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-8 text-center">
                Frequently Asked Questions
              </h2>
            </FadeInUp>
            <div className="space-y-6">
              {FAQ_ITEMS.map((item) => (
                <FadeInUp key={item.q}>
                  <div className="border border-border rounded-lg p-6">
                    <h3 className="text-sm font-semibold text-foreground mb-2">
                      {item.q}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {item.a}
                      {item.link && (
                        <>
                          {" "}
                          <Link
                            href={item.link.href}
                            className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                          >
                            {item.link.label}
                          </Link>
                          .
                        </>
                      )}
                    </p>
                  </div>
                </FadeInUp>
              ))}
              <FadeInUp>
                <div className="border border-border rounded-lg p-6">
                  <h3 className="text-sm font-semibold text-foreground mb-2">
                    Where can I learn more about billing?
                  </h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    See the{" "}
                    <Link
                      href="/docs/concepts/billing"
                      className="text-foreground underline underline-offset-4 hover:text-foreground/80"
                    >
                      billing documentation
                    </Link>{" "}
                    for how plans are invoiced, how plan changes and
                    cancellations work, and where to see your token usage.
                  </p>
                </div>
              </FadeInUp>
            </div>
          </div>
        </section>

        {/* Enterprise CTA */}
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-3xl mx-auto text-center">
            <FadeInUp>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                Need custom terms?
              </h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                For Stigmer Enterprise on your own infrastructure, or Enterprise
                Cloud on an annual contract — talk to our team.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button asChild size="lg">
                  <a href={SITE_CONFIG.cloudSignupUrl}>Start free</a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  <Link href={SITE_CONFIG.contactSalesUrl}>
                    Contact Sales
                  </Link>
                </Button>
              </div>
            </FadeInUp>
            <FadeInUp delay={0.2}>
              <p className="text-sm text-subtle mt-8">
                Stigmer&apos;s core is open source under Apache 2.0.
                Self-host it anytime — no vendor lock-in.
              </p>
            </FadeInUp>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

interface PlanCardProps {
  plan: Plan;
}

function PlanCard({ plan }: PlanCardProps) {
  const featured = plan.featured === true;
  return (
    <div
      className={cn(
        "bg-background p-6 sm:p-8 h-full flex flex-col",
        featured && "bg-card",
      )}
    >
      <div className="mb-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-subtle mb-3">
          {plan.name}
        </h3>
        <div className="flex items-baseline gap-1.5 mb-2">
          <span className="text-3xl font-bold text-foreground">
            {plan.price}
          </span>
          {plan.period && (
            <span className="text-sm text-muted-foreground">
              {plan.period}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{plan.description}</p>
      </div>

      <ul className="space-y-3 mb-8" aria-label={`${plan.name} features`}>
        {featureLines(plan).map((line) => (
          <li
            key={line}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <Icon
              name="check"
              size="sm"
              className="text-foreground shrink-0 mt-0.5"
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto">
        <Button
          asChild
          variant={featured ? "default" : "outline"}
          className="w-full"
        >
          {plan.cta.internal ? (
            <Link href={plan.cta.href}>{plan.cta.label}</Link>
          ) : (
            <a href={plan.cta.href}>{plan.cta.label}</a>
          )}
        </Button>
      </div>
    </div>
  );
}

/**
 * A card's lines: what it includes, then each feature and each of a Cloud
 * plan's terms, in the console's words.
 */
function featureLines(plan: Plan): readonly string[] {
  const features = plan.features.map((feature) =>
    typeof feature === "string" ? feature : FEATURE_COPY[feature].label,
  );
  const terms =
    plan.terms === undefined
      ? []
      : planTermLines(plan.terms.entitlements, plan.terms.terms);
  return [
    ...(plan.includes === undefined ? [] : [plan.includes]),
    ...features,
    ...terms,
  ];
}

export { PricingPage };
