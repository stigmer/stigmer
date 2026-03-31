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

const USE_CASES = [
  {
    id: "healthcare",
    industry: "Healthcare SaaS",
    title: "Patient intake and triage agent",
    builder:
      "You build clinic management software. Multi-location practices use your platform for scheduling, patient records, and billing.",
    challenge:
      "Patients call with refill requests, appointment questions, and symptom concerns. Your chatbot gives generic medical advice. It doesn't know each clinic's triage protocols, available services, or physician specialties. Patients get bad answers and call the clinic anyway.",
    capabilities: [
      {
        pillar: "Knows Your Business",
        description:
          "Each clinic uploads its own protocols — triage guidelines, available services, physician specialties, appointment policies. The agent answers questions specific to that clinic.",
      },
      {
        pillar: "Uses Your Tools",
        description:
          "The agent connects to the clinic's scheduling and patient records systems. It checks appointment availability, submits intake forms, and initiates prescription refills.",
      },
      {
        pillar: "Asks Before Acting",
        description:
          "Clinical decisions — symptom escalations, medication-related questions — require physician or nurse review. Routine scheduling and refill requests are handled automatically.",
      },
    ],
    proof: {
      question: "I need to refill my blood pressure medication.",
      answer:
        "Your Lisinopril 10mg is eligible for refill — your last appointment was within the 90-day window. I've sent the refill request to Dr. Patel for approval.",
    },
    outcome:
      "Every clinic on your platform has a patient-facing agent that knows their protocols, handles routine requests, and routes clinical decisions to the right physician.",
  },
  {
    id: "hr",
    industry: "HR & People Platform",
    title: "Employee onboarding assistant",
    builder:
      "You build HR software for mid-size companies. Your clients use the platform for hiring, onboarding, benefits enrollment, and time tracking.",
    challenge:
      "Onboarding is a multi-week process — paperwork, system access, equipment requests, policy acknowledgments, training assignments. Each client company has different policies. HR teams walk every new hire through the same steps manually. It's slow, error-prone, and doesn't scale.",
    capabilities: [
      {
        pillar: "Knows Your Business",
        description:
          "Each company uploads its own onboarding materials — employee handbook, benefits guide, IT access policies, training requirements by role.",
      },
      {
        pillar: "Uses Your Tools",
        description:
          "The agent connects to your platform's systems — submits IT access requests, enrolls new hires in benefits, assigns training modules, and tracks completion.",
      },
      {
        pillar: "Asks Before Acting",
        description:
          "Equipment requests need manager approval. Standard access and training tasks are handled automatically.",
      },
    ],
    proof: {
      question: "What health insurance options do I have?",
      answer:
        "Acme Corp offers three plans: Basic ($0/month, $3,000 deductible), Plus ($120/month, $1,500 deductible), and Premium ($280/month, $500 deductible). Your enrollment deadline is April 15. Would you like me to start your enrollment?",
    },
    outcome:
      "Every company on your platform has an onboarding agent that knows their policies, walks new hires through each step, and keeps the process moving without HR intervention.",
  },
  {
    id: "fintech",
    industry: "FinTech / Banking-as-a-Service",
    title: "Compliance monitoring agent",
    builder:
      "You build a banking-as-a-service platform. Fintechs and neobanks use it to offer banking products without building their own banking infrastructure.",
    challenge:
      "Every client has different compliance requirements depending on their products, jurisdictions, and risk profiles. Manual compliance review is expensive and slow. Your AI assistant doesn't know each client's specific thresholds or reporting obligations.",
    capabilities: [
      {
        pillar: "Knows Your Business",
        description:
          "Each client uploads their compliance rules — transaction thresholds, reporting triggers, risk categories, jurisdiction-specific requirements.",
      },
      {
        pillar: "Uses Your Tools",
        description:
          "The agent connects to the transaction ledger and identity verification systems. It flags transactions, pulls customer profiles, and generates preliminary compliance reports.",
      },
      {
        pillar: "Asks Before Acting",
        description:
          "Flagging a transaction as suspicious or filing a regulatory report requires compliance officer review. Routine monitoring and low-risk alerts are handled automatically.",
      },
    ],
    proof: {
      question: "Summarize today's flagged transactions for NeoBank.",
      answer:
        "NeoBank had 3 flagged transactions today. Two are velocity alerts — the same account made 12 transfers in 4 hours, exceeding NeoBank's 8-per-day threshold. One is a cross-border payment to a jurisdiction on NeoBank's enhanced-review list. All three are pending your review.",
    },
    outcome:
      "Every client on your platform has a compliance agent that knows their regulatory rules, monitors transactions in real time, and routes decisions to the right compliance officer.",
  },
  {
    id: "education",
    industry: "EdTech",
    title: "Course tutor and academic assistant",
    builder:
      "You build an online learning platform. Instructors create courses, students enroll, and your platform handles content delivery, assignments, and grading.",
    challenge:
      "Students get stuck and need help outside class hours. Instructors can't answer every question individually. Your chatbot gives generic educational advice that doesn't match the specific course content or grading rubric. Worse, it has no memory.",
    capabilities: [
      {
        pillar: "Knows Your Business",
        description:
          "Each course has its own knowledge — syllabus, lecture notes, assignment rubrics, grading policies, academic integrity rules.",
      },
      {
        pillar: "Uses Your Tools",
        description:
          "The agent connects to the learning management system. It checks assignment submissions, looks up grades, and flags questions for the instructor when the answer isn't covered by the course materials.",
      },
      {
        pillar: "Asks Before Acting",
        description:
          "Conversations persist across weeks. A student working through a multi-week project can ask follow-up questions days apart, and the agent picks up where they left off.",
      },
    ],
    proof: {
      question:
        "I'm confused about the regression analysis in my project. We talked about this last Tuesday.",
      answer:
        "Right — last time we worked through your dataset's multicollinearity issue. Your next step was to apply variance inflation factors. Did you get a chance to run that, or would you like to walk through it together?",
    },
    outcome:
      "Every course on your platform has a tutoring agent that knows the course material, remembers each student's progress, and provides help at any hour.",
  },
  {
    id: "legal",
    industry: "Legal Tech",
    title: "Contract analysis agent",
    builder:
      "You build contract lifecycle management software. Law firms and corporate legal departments use your platform to draft, review, negotiate, and manage contracts.",
    challenge:
      "Contract review is the most time-consuming part of legal work. Attorneys compare clauses against precedent, check for non-standard language, and flag risk — manually, for every agreement. Your AI assistant doesn't know the firm's clause library or risk tolerance.",
    capabilities: [
      {
        pillar: "Knows Your Business",
        description:
          "Each firm or legal department uploads its own clause library, risk policies, and review standards. The agent compares incoming contracts against the firm's specific precedent.",
      },
      {
        pillar: "Uses Your Tools",
        description:
          "The agent connects to the contract management system. It pulls active contracts, compares clause versions, and annotates documents with findings.",
      },
      {
        pillar: "Asks Before Acting",
        description:
          "Recommendations that affect legal liability — accepting non-standard indemnification, modifying IP assignment — require attorney approval. Standard clause comparisons are handled automatically.",
      },
    ],
    proof: {
      question: "Review the indemnification clause in the Meridian contract.",
      answer:
        "The Meridian contract uses mutual uncapped indemnification. Your firm's standard is mutual capped indemnification limited to 2x contract value. This is a material deviation — I've flagged it for your review with a recommended redline.",
    },
    outcome:
      "Every firm on your platform has a contract analysis agent that knows their clause library, compares incoming agreements against their standards, and pauses for attorney review on material deviations.",
  },
];

function UseCasesPage() {
  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        {/* Page header */}
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-4xl mx-auto text-center">
            <FadeInUp>
              <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
                Use cases
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-foreground mb-6">
                What you can build
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                Every platform that serves multiple tenants, needs system actions,
                and has risk-graduated decisions is a fit. Here are five industries
                where Stigmer is already making agents real.
              </p>
            </FadeInUp>
          </div>
        </section>

        {/* Use cases */}
        <section className="pb-24">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            {USE_CASES.map((uc, index) => (
              <FadeInUp key={uc.id} delay={index * 0.05}>
                <UseCaseEntry useCase={uc} />
              </FadeInUp>
            ))}
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="py-16 border-t border-border">
          <div className="max-w-4xl mx-auto px-4 text-center">
            <FadeInUp>
              <h2 className="text-2xl font-bold text-foreground mb-4">
                Does this sound like your platform?
              </h2>
              <p className="text-muted-foreground mb-8 max-w-xl mx-auto">
                If your platform has per-tenant knowledge, system actions, and
                risk-graduated decisions, Stigmer fits. Your first agent takes five
                minutes.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button asChild size="lg">
                  <a href={SITE_CONFIG.cloudSignupUrl}>
                    Start Free
                    <Icon name="arrow-right" size="sm" />
                  </a>
                </Button>
                <Button asChild variant="outline" size="lg">
                  {/* TODO: Phase 3 — update to /docs/getting-started/quickstart */}
                  <Link href="/docs">
                    Read the Docs
                  </Link>
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

function UseCaseEntry({
  useCase,
}: {
  useCase: (typeof USE_CASES)[number];
}) {
  return (
    <article className="py-12 border-t border-border" id={useCase.id}>
      <div className="mb-8">
        <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-2">
          {useCase.industry}
        </p>
        <h2 className="text-2xl font-bold text-foreground mb-3">
          {useCase.title}
        </h2>
        <p className="text-muted-foreground leading-relaxed">
          {useCase.builder}
        </p>
      </div>

      {/* Challenge */}
      <div className="mb-8">
        <h3 className="text-xs font-mono uppercase tracking-wider text-subtle mb-3">
          The challenge
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {useCase.challenge}
        </p>
      </div>

      {/* Capabilities */}
      <div className="mb-8 space-y-4">
        <h3 className="text-xs font-mono uppercase tracking-wider text-subtle mb-3">
          How Stigmer powers it
        </h3>
        {useCase.capabilities.map((cap) => (
          <div key={cap.pillar} className="flex items-start gap-3">
            <span className="text-xs font-mono text-subtle shrink-0 pt-0.5 w-36">
              {cap.pillar}
            </span>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {cap.description}
            </p>
          </div>
        ))}
      </div>

      {/* Proof */}
      <div className="rounded-lg border border-border p-4 sm:p-6 bg-card mb-8">
        <p className="text-foreground font-medium mb-3">
          &ldquo;{useCase.proof.question}&rdquo;
        </p>
        <p className="text-sm text-muted-foreground leading-relaxed">
          → {useCase.proof.answer}
        </p>
      </div>

      {/* Outcome */}
      <p className="text-sm text-muted-foreground leading-relaxed">
        {useCase.outcome}
      </p>
    </article>
  );
}

export { UseCasesPage };
