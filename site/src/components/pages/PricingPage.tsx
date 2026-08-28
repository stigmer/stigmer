"use client";

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
import { CostCalculator } from "@/components/pages/pricing/CostCalculator";
import { ModelPricingTable } from "@/components/pages/pricing/ModelPricingTable";
import type { ModelPricingEntry } from "@/components/pages/pricing/types";

const CREDIT_PACKS = [
  {
    id: "starter",
    name: "Starter",
    price: 10,
    credits: "1,000",
    description: "Try it out with a small balance.",
  },
  {
    id: "growth",
    name: "Growth",
    price: 50,
    credits: "5,000",
    description: "For regular development and testing.",
    featured: true,
  },
  {
    id: "team",
    name: "Team",
    price: 200,
    credits: "20,000",
    description: "For production workloads and teams.",
  },
] as const;

const HOW_IT_WORKS_STEPS = [
  {
    number: "1",
    title: "Sign up and get trial credits",
    description:
      "Create an account and receive free credits to explore the platform. No credit card required.",
  },
  {
    number: "2",
    title: "Run agents, pay per LLM call",
    description:
      "Each LLM call during agent execution is metered and debited from your balance at transparent per-token rates.",
  },
  {
    number: "3",
    title: "Buy more or auto-recharge",
    description:
      "Purchase credit packs when you need them, or enable auto-recharge to keep your balance topped up automatically.",
  },
] as const;

type FaqItem = {
  q: string;
  a: string;
  /** Optional deep link rendered after the answer. */
  link?: { href: string; label: string };
};

const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: "What are credits?",
    a: "Credits are dollar-denominated units used for Stigmer Cloud billing. 1 credit = $0.01 USD. When your AI agents make LLM calls, tokens are metered and the cost is debited from your credit balance.",
  },
  {
    q: "Do credits expire?",
    a: "Purchased credits expire 12 months after purchase. Promotional and trial credits expire after 90 days. Credits are non-refundable once used.",
  },
  {
    q: "How does auto-recharge work?",
    a: "Save a payment method during your first purchase. Then configure auto-recharge in your billing settings — set a threshold, recharge amount, and monthly cap. When your balance drops below the threshold, we automatically charge your saved card.",
  },
  {
    q: "What happens when my balance runs out?",
    a: "Running executions will finish their current LLM call, then stop gracefully. You will see low-balance warnings before that happens. New executions cannot start until credits are added.",
  },
  {
    q: "Can I self-host for free?",
    a: "Yes. Stigmer is fully open source under Apache 2.0. Self-host it anywhere — there is no vendor lock-in. Cloud billing only applies when you use Stigmer Cloud (app.stigmer.ai).",
    link: {
      href: "/docs/guides/self-hosting/cloud-vs-self-hosted",
      label: "Compare cloud and self-hosted",
    },
  },
  {
    q: "How is pricing calculated?",
    a: "Each LLM call is priced based on the model used and the number of input and output tokens. Rates include a small platform margin over provider costs. See the pricing table above for exact per-model rates.",
  },
] as const;

function PricingPage() {
  const [pricingData, setPricingData] = React.useState<ModelPricingEntry[]>([]);
  const [pricingLoaded, setPricingLoaded] = React.useState(false);

  React.useEffect(() => {
    fetch(`${SITE_CONFIG.cloudApiUrl}/api/v1/public/model-pricing`)
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: { entries: ModelPricingEntry[] }) => {
        setPricingData(data.entries);
        setPricingLoaded(true);
      })
      .catch(() => {
        setPricingLoaded(true);
      });
  }, []);

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
                Pay only for what you use.
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Stigmer Cloud uses prepaid credits. Purchase credits, run your
                AI agents, and only pay for the LLM calls they make.
                Transparent per-token pricing with no hidden fees.
              </p>
            </FadeInUp>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-12 sm:py-16 px-4">
          <div className="max-w-5xl mx-auto">
            <FadeInUp>
              <h2 className="text-xs font-mono uppercase tracking-wider text-subtle mb-8 text-center">
                How it works
              </h2>
            </FadeInUp>
            <StaggerContainer
              className="grid grid-cols-1 md:grid-cols-3 gap-8"
              staggerDelay={0.1}
              delayChildren={0.1}
            >
              {HOW_IT_WORKS_STEPS.map((step) => (
                <StaggerItem key={step.number}>
                  <div className="text-center">
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-border text-sm font-mono text-foreground mb-4">
                      {step.number}
                    </div>
                    <h3 className="text-sm font-semibold text-foreground mb-2">
                      {step.title}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </StaggerItem>
              ))}
            </StaggerContainer>
          </div>
        </section>

        {/* Credit Packs */}
        <section className="py-12 sm:py-16 px-4">
          <div className="max-w-5xl mx-auto">
            <FadeInUp>
              <div className="text-center mb-12">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                  Credit Packs
                </h2>
                <p className="text-sm text-muted-foreground">
                  Purchase credits in packs. 1 credit = $0.01 USD.
                </p>
              </div>
            </FadeInUp>

            <StaggerContainer
              className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border"
              staggerDelay={0.1}
              delayChildren={0.1}
            >
              {CREDIT_PACKS.map((pack) => (
                <StaggerItem key={pack.id}>
                  <CreditPackCard pack={pack} />
                </StaggerItem>
              ))}
            </StaggerContainer>

            <FadeInUp delay={0.3}>
              <div className="text-center mt-8">
                <p className="text-sm text-subtle">
                  All new accounts receive free trial credits. No credit card
                  required to start.
                </p>
              </div>
            </FadeInUp>
          </div>
        </section>

        {/* Model Pricing Table */}
        {pricingLoaded && pricingData.length > 0 && (
          <section className="py-12 sm:py-16 px-4">
            <div className="max-w-5xl mx-auto">
              <FadeInUp>
                <div className="text-center mb-12">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                    Per-Model Pricing
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                    Prices per million tokens, including platform margin.
                    These are what you pay — not raw provider rates.
                  </p>
                </div>
              </FadeInUp>
              <FadeInUp delay={0.1}>
                <ModelPricingTable entries={pricingData} />
              </FadeInUp>
            </div>
          </section>
        )}

        {/* Cost Calculator */}
        {pricingLoaded && pricingData.length > 0 && (
          <section className="py-12 sm:py-16 px-4" id="calculator">
            <div className="max-w-4xl mx-auto">
              <FadeInUp>
                <div className="text-center mb-12">
                  <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-4">
                    Estimate Your Cost
                  </h2>
                  <p className="text-sm text-muted-foreground max-w-xl mx-auto">
                    Select the models you plan to use and estimate your monthly
                    token volume to see projected costs.
                  </p>
                </div>
              </FadeInUp>
              <FadeInUp delay={0.1}>
                <CostCalculator models={pricingData} />
              </FadeInUp>
            </div>
          </section>
        )}

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
                    for a full explanation of how credits, reservations,
                    auto-recharge, and pricing policies work.
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
                Need custom pricing?
              </h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                For committed usage, volume discounts, invoiced billing, or
                dedicated infrastructure — talk to our team.
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

interface CreditPackCardProps {
  pack: (typeof CREDIT_PACKS)[number];
}

function CreditPackCard({ pack }: CreditPackCardProps) {
  const featured = "featured" in pack && pack.featured;
  return (
    <div
      className={cn(
        "bg-background p-6 sm:p-8 h-full flex flex-col",
        featured && "bg-card",
      )}
    >
      <div className="mb-6">
        <h3 className="text-xs font-mono uppercase tracking-wider text-subtle mb-3">
          {pack.name}
        </h3>
        <div className="flex items-baseline gap-1.5 mb-2">
          <span className="text-3xl font-bold text-foreground">
            ${pack.price}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">{pack.description}</p>
      </div>

      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
        <Icon
          name="check"
          size="sm"
          className="text-foreground shrink-0"
        />
        <span>{pack.credits} credits included</span>
      </div>

      <div className="mt-auto">
        <Button
          asChild
          variant={featured ? "default" : "outline"}
          className="w-full"
        >
          <a href={SITE_CONFIG.cloudSignupUrl}>Get Started</a>
        </Button>
      </div>
    </div>
  );
}

export { PricingPage };
