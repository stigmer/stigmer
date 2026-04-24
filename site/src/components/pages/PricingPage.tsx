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

interface Tier {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  href: string;
  featured: boolean;
  waitlist?: boolean;
}

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    period: "forever",
    description: "For getting started and prototyping.",
    features: [
      "1 agent",
      "1,000 executions / month",
      "Community support",
      "All SDKs included",
    ],
    cta: "Start Free",
    href: SITE_CONFIG.cloudSignupUrl,
    featured: false,
  },
  {
    name: "Pro",
    price: "Coming soon",
    period: "",
    description: "For production workloads and growing teams.",
    features: [
      "Unlimited agents",
      "Unlimited executions",
      "Priority support",
      "Custom domains",
      "Advanced analytics",
    ],
    cta: "Join Waitlist",
    href: SITE_CONFIG.waitlistUrl,
    featured: true,
    waitlist: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "For teams that need dedicated support, SLAs, and compliance.",
    features: [
      "Everything in Pro",
      "Dedicated infrastructure",
      "SSO / SAML",
      "99.99% SLA",
      "Dedicated support",
      "Custom contracts",
    ],
    cta: "Contact Sales",
    href: SITE_CONFIG.contactSalesUrl,
    featured: false,
  },
];

type WaitlistStatus = "idle" | "submitting" | "success" | "error";

function WaitlistForm() {
  const [status, setStatus] = React.useState<WaitlistStatus>("idle");
  const [email, setEmail] = React.useState("");
  const loadedAt = React.useRef(Date.now());

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");

    try {
      const res = await fetch(
        `${SITE_CONFIG.leadsFormUrl}/submit/waitlist`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "waitlist",
            email,
            _t: Date.now() - loadedAt.current,
          }),
        },
      );

      if (!res.ok) throw new Error(`${res.status}`);
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  if (status === "success") {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground">
        <Icon name="check" size="sm" />
        <span>You are on the list. We will be in touch.</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2" id="waitlist">
      <div className="flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className={cn(
            "flex-1 min-w-0 rounded border border-border bg-background px-3 py-2",
            "text-sm text-foreground placeholder:text-subtle",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
          )}
        />
        <Button
          type="submit"
          size="default"
          disabled={status === "submitting"}
          className="shrink-0"
        >
          {status === "submitting" ? "..." : "Join"}
        </Button>
      </div>
      {status === "error" && (
        <p className="text-xs text-destructive">
          Something went wrong. Please try again.
        </p>
      )}
    </form>
  );
}

function TierCard({ tier }: { tier: Tier }) {
  return (
    <div
      className={cn(
        "bg-background p-6 sm:p-8 h-full flex flex-col",
        tier.featured && "bg-card",
      )}
    >
      <div className="mb-6">
        <h2 className="text-xs font-mono uppercase tracking-wider text-subtle mb-3">
          {tier.name}
        </h2>
        <div className="flex items-baseline gap-1.5 mb-2">
          <span className="text-3xl font-bold text-foreground">
            {tier.price}
          </span>
          {tier.period && (
            <span className="text-sm text-subtle">/ {tier.period}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{tier.description}</p>
      </div>

      <ul className="space-y-3 mb-8 flex-1">
        {tier.features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <Icon
              name="check"
              size="sm"
              className="text-foreground shrink-0 mt-0.5"
            />
            {feature}
          </li>
        ))}
      </ul>

      {tier.waitlist ? (
        <WaitlistForm />
      ) : (
        <Button
          asChild
          variant={tier.featured ? "default" : "outline"}
          className="w-full"
        >
          {tier.href.startsWith("/") ? (
            <Link href={tier.href}>{tier.cta}</Link>
          ) : (
            <a href={tier.href}>{tier.cta}</a>
          )}
        </Button>
      )}
    </div>
  );
}

function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-5xl mx-auto">
            <FadeInUp>
              <div className="text-center mb-16">
                <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
                  Pricing
                </p>
                <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-6">
                  Start free. Scale when ready.
                </h1>
                <p className="text-lg text-muted-foreground max-w-xl mx-auto">
                  Every plan includes the full open-source platform. Cloud
                  pricing covers hosting, execution, and support.
                </p>
              </div>
            </FadeInUp>

            <StaggerContainer
              className="grid grid-cols-1 md:grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border"
              staggerDelay={0.1}
              delayChildren={0.1}
            >
              {TIERS.map((tier) => (
                <StaggerItem key={tier.name}>
                  <TierCard tier={tier} />
                </StaggerItem>
              ))}
            </StaggerContainer>

            <FadeInUp delay={0.3}>
              <div className="text-center mt-12">
                <p className="text-sm text-subtle">
                  All plans include the full Apache 2.0 open-source platform.
                  Self-host anytime — no vendor lock-in.
                </p>
              </div>
            </FadeInUp>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export { PricingPage };
