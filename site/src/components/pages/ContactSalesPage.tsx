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
import { FadeInUp } from "@/components/ui/motion";

type FormStatus = "idle" | "submitting" | "success" | "error";

const inputClasses = cn(
  "w-full rounded border border-border bg-card px-4 py-3",
  "text-sm text-foreground placeholder:text-subtle",
  "transition-colors",
  "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

function ContactSalesPage() {
  const [status, setStatus] = React.useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = React.useState("");
  const loadedAt = React.useRef(Date.now());

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("submitting");
    setErrorMessage("");

    const form = e.currentTarget;
    const data = new FormData(form);

    if (data.get("website")) {
      setStatus("success");
      return;
    }

    const payload = {
      type: "contact-sales",
      name: data.get("name"),
      email: data.get("email"),
      company: data.get("company"),
      message: data.get("message"),
      website: data.get("website"),
      _t: Date.now() - loadedAt.current,
    };

    try {
      const res = await fetch(
        `${SITE_CONFIG.cloudApiUrl}/api/v1/public/leads/contact-sales`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        throw new Error(`${res.status}`);
      }

      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMessage(
        "Something went wrong. Please try again or email us directly.",
      );
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-xl mx-auto">
            <FadeInUp>
              <div className="mb-12">
                <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
                  Enterprise
                </p>
                <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
                  Contact Sales
                </h1>
                <p className="text-muted-foreground leading-relaxed">
                  Tell us about your use case and we will get back to you within
                  one business day. Enterprise plans include dedicated
                  infrastructure, SSO&nbsp;/ SAML, SLAs, and custom contracts.
                </p>
              </div>
            </FadeInUp>

            {status === "success" ? (
              <FadeInUp>
                <div className="rounded-lg border border-border bg-card p-8 text-center">
                  <div className="mb-4 inline-flex items-center justify-center w-12 h-12 rounded-full bg-muted">
                    <Icon name="check" size="lg" className="text-foreground" />
                  </div>
                  <h2 className="text-xl font-bold text-foreground mb-2">
                    Message received
                  </h2>
                  <p className="text-muted-foreground mb-6">
                    We will reach out within one business day. In the meantime,
                    feel free to explore the docs.
                  </p>
                  <Button asChild variant="outline">
                    <Link href="/docs">Read the Docs</Link>
                  </Button>
                </div>
              </FadeInUp>
            ) : (
              <FadeInUp delay={0.1}>
                <form
                  onSubmit={handleSubmit}
                  className="space-y-5"
                >
                  <div>
                    <label
                      htmlFor="name"
                      className="block text-xs font-mono uppercase tracking-wider text-subtle mb-2"
                    >
                      Name
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      required
                      autoComplete="name"
                      className={inputClasses}
                      placeholder="Jane Smith"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="email"
                      className="block text-xs font-mono uppercase tracking-wider text-subtle mb-2"
                    >
                      Work email
                    </label>
                    <input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      className={inputClasses}
                      placeholder="jane@acme.com"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="company"
                      className="block text-xs font-mono uppercase tracking-wider text-subtle mb-2"
                    >
                      Company
                    </label>
                    <input
                      id="company"
                      name="company"
                      type="text"
                      required
                      autoComplete="organization"
                      className={inputClasses}
                      placeholder="Acme Corp"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="message"
                      className="block text-xs font-mono uppercase tracking-wider text-subtle mb-2"
                    >
                      How can we help?
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      required
                      rows={4}
                      className={cn(inputClasses, "resize-y min-h-[6rem]")}
                      placeholder="Tell us about your use case, team size, and any requirements..."
                    />
                  </div>

                  {/* Honeypot — hidden from humans, visible to bots */}
                  <div className="absolute -left-[9999px]" aria-hidden="true">
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                    />
                  </div>

                  {status === "error" && (
                    <p className="text-sm text-destructive">{errorMessage}</p>
                  )}

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full"
                    disabled={status === "submitting"}
                  >
                    {status === "submitting" ? "Sending..." : "Send Message"}
                  </Button>
                </form>
              </FadeInUp>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

export { ContactSalesPage };
