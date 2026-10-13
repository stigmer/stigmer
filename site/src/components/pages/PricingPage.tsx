/**
 * The public pricing page: Stigmer Cloud's four flat plans, what each adds,
 * and the one rule behind them — models run on the customer's own provider
 * keys, so the provider bills every token and Stigmer charges only for the
 * platform.
 *
 * The plan copy is static and mirrors the console's own plan cards (fee,
 * features, child organizations), so a visitor reads the same words before
 * and after signing up. Nothing is fetched: there is no price list to load
 * because no token is priced.
 */
import * as React from "react";
import Link from "next/link";
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
  features: readonly string[];
  cta: { label: string; href: string; internal?: boolean };
  featured?: boolean;
};

const PLANS: readonly Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "/month",
    description: "Build agents and put them in front of people.",
    features: ["Channels", "Sharing", "Unlimited members"],
    cta: { label: "Start Free", href: SITE_CONFIG.cloudSignupUrl },
  },
  {
    id: "team",
    name: "Team",
    price: "$99",
    period: "/month",
    description: "Organize your members and grant access by team.",
    features: ["Everything in Free", "Teams"],
    cta: { label: "Get Started", href: SITE_CONFIG.cloudSignupUrl },
    featured: true,
  },
  {
    id: "business",
    name: "Business",
    price: "$499",
    period: "/month",
    description: "Run organizations for your own customers under yours.",
    features: [
      "Everything in Team",
      "Child organizations",
      "5 child organizations included, then $25/month each",
    ],
    cta: { label: "Get Started", href: SITE_CONFIG.cloudSignupUrl },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    description: "Quoted for your organization.",
    features: [
      "A dedicated deployment",
      "SSO enforcement",
      "An SLA",
      "Annual invoicing",
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
    a: "No. A plan's price is its flat monthly fee, and Stigmer never adds anything to a model call. Your token usage is still counted, so you can see it per run, session, agent and organization in the console and the CLI.",
    link: {
      href: "/docs/concepts/billing#see-your-usage",
      label: "See your usage",
    },
  },
  {
    q: "Whose model keys do my agents use?",
    a: "Your own. An admin adds your organization's Anthropic or OpenAI key, a compatible endpoint, or a Cursor key in the console, and every model call runs on it, on every plan. Your provider bills those calls to you directly.",
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
    q: "Can I self-host for free?",
    a: "Yes. Stigmer's core is open source under Apache 2.0; Stigmer Enterprise, in the repository's ee/ directory, is public under the Stigmer Enterprise License and needs a license key in production. Self-host it anywhere — there is no vendor lock-in. Cloud plans only apply when you use Stigmer Cloud (app.stigmer.ai).",
    link: {
      href: "/docs/guides/self-hosting/cloud-vs-self-hosted",
      label: "Compare cloud and self-hosted",
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
                Every Stigmer Cloud plan is a flat monthly fee. Your agents run
                on your own model provider keys, so your provider bills every
                token directly and Stigmer adds nothing to it.
              </p>
            </FadeInUp>
          </div>
        </section>

        {/* Plans */}
        <section className="py-12 sm:py-16 px-4">
          <div className="max-w-6xl mx-auto">
            <FadeInUp>
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                  Plans
                </h2>
                <p className="text-sm text-muted-foreground">
                  Every organization starts on Free. Upgrade when you need
                  what a plan adds.
                </p>
              </div>
            </FadeInUp>

            <StaggerContainer
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-border rounded-lg overflow-hidden border border-border"
              staggerDelay={0.1}
              delayChildren={0.1}
            >
              {PLANS.map((plan) => (
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
                For a dedicated deployment, SSO enforcement, an SLA or annual
                invoicing — talk to our team.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <Button asChild size="lg">
                  <a href={SITE_CONFIG.cloudSignupUrl}>Start Free</a>
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
                All plans include the full Apache 2.0 open-source platform.
                Self-host anytime — no vendor lock-in.
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
        {plan.features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <Icon
              name="check"
              size="sm"
              className="text-foreground shrink-0 mt-0.5"
            />
            <span>{feature}</span>
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

export { PricingPage };
