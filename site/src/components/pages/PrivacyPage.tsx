import * as React from "react";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SkipLink } from "@/components/ui/skip-link";

const EFFECTIVE_DATE = "July 17, 2026";

/**
 * Static legal page — intentionally a server component (no interactivity),
 * unlike the form-bearing marketing pages in this directory.
 */
function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        <section className="py-16 sm:py-24 px-4">
          <div className="max-w-3xl mx-auto">
            <div className="mb-12">
              <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
                Legal
              </p>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
                Privacy Policy
              </h1>
              <p className="text-sm text-subtle">Effective {EFFECTIVE_DATE}</p>
            </div>

            <div className="space-y-10 text-muted-foreground leading-relaxed">
              <PolicySection title="Who we are">
                <p>
                  Stigmer provides an open-source platform and a hosted cloud
                  service (Stigmer Cloud, at app.stigmer.ai) for building and
                  running AI agents. This policy describes how we collect, use,
                  and protect information when you use the stigmer.ai website
                  and Stigmer Cloud. The open-source software you run on your
                  own infrastructure does not send data to us.
                </p>
              </PolicySection>

              <PolicySection title="Information we collect">
                <ul className="list-disc pl-5 space-y-2">
                  <li>
                    <strong className="text-foreground">Account information.</strong>{" "}
                    Your name, email address, and profile details, received
                    from the identity provider you sign in with.
                  </li>
                  <li>
                    <strong className="text-foreground">Content you provide.</strong>{" "}
                    Messages, files, and configuration you submit to agents you
                    or your organization run — including messages sent to your
                    agents through connected channels such as Slack or
                    WhatsApp. This content is processed to produce the
                    agent&apos;s response and stored so you can review
                    conversations.
                  </li>
                  <li>
                    <strong className="text-foreground">Credentials you store.</strong>{" "}
                    API keys, tokens, and secrets you register so your agents
                    can use tools. These are encrypted at rest and used only to
                    execute the work you configure.
                  </li>
                  <li>
                    <strong className="text-foreground">Billing information.</strong>{" "}
                    Payments are processed by Stripe; we do not store your card
                    details. We keep records of credit balances and usage.
                  </li>
                  <li>
                    <strong className="text-foreground">Usage data.</strong>{" "}
                    Logs and metrics about how the service is used — such as
                    request timestamps, feature usage, and error reports — used
                    to operate, secure, and improve the service.
                  </li>
                </ul>
              </PolicySection>

              <PolicySection title="How we use information">
                <p>
                  We use the information above to provide and operate the
                  service, execute the agents and workflows you configure, bill
                  for usage, provide support, maintain security (including
                  rate limiting and abuse prevention), and improve the
                  platform. We do not sell your personal information, and we do
                  not use your content to train our own or third-party
                  foundation models.
                </p>
              </PolicySection>

              <PolicySection title="Who we share it with">
                <p>
                  Agent execution relies on third-party services acting on our
                  behalf:
                </p>
                <ul className="list-disc pl-5 space-y-2 mt-3">
                  <li>
                    <strong className="text-foreground">Model providers.</strong>{" "}
                    The content of a conversation is sent to the large language
                    model provider serving that agent (for example Anthropic or
                    OpenAI) to generate responses.
                  </li>
                  <li>
                    <strong className="text-foreground">Messaging platforms.</strong>{" "}
                    When you connect an agent to a channel such as Slack or
                    WhatsApp, messages flow through that platform under its own
                    terms and privacy policy.
                  </li>
                  <li>
                    <strong className="text-foreground">Infrastructure and payments.</strong>{" "}
                    Cloud hosting, storage, and payment processing providers
                    that run the service.
                  </li>
                </ul>
                <p className="mt-3">
                  We may also disclose information when required by law or to
                  protect the rights, safety, or security of Stigmer, our
                  users, or others.
                </p>
              </PolicySection>

              <PolicySection title="Data retention and deletion">
                <p>
                  We retain your data while your account or organization is
                  active. Deleting a resource (such as an agent, session, or
                  stored credential) removes it from active use; residual
                  copies in backups are purged on our regular backup cycle. To
                  delete your account or organization entirely, contact us and
                  we will complete the deletion within 30 days.
                </p>
              </PolicySection>

              <PolicySection title="Security">
                <p>
                  Data is encrypted in transit. Secrets and credentials you
                  store are additionally encrypted at rest. Access to
                  production systems is restricted and audited. No system is
                  perfectly secure — if we learn of a breach affecting your
                  data, we will notify you promptly.
                </p>
              </PolicySection>

              <PolicySection title="Your rights">
                <p>
                  Depending on where you live, you may have rights to access,
                  correct, export, or delete your personal information, or to
                  object to certain processing. You can exercise most of these
                  directly in the product; for anything else, contact us and we
                  will respond within 30 days.
                </p>
              </PolicySection>

              <PolicySection title="Changes to this policy">
                <p>
                  When we make material changes to this policy, we will update
                  the effective date above and, for significant changes, notify
                  you through the service or by email.
                </p>
              </PolicySection>

              <PolicySection title="Contact">
                <p>
                  Questions about this policy or your data? Reach us on{" "}
                  <a
                    href="https://github.com/stigmer/stigmer/discussions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-foreground underline underline-offset-4 hover:opacity-80 transition-opacity"
                  >
                    GitHub Discussions
                  </a>{" "}
                  or email{" "}
                  <a
                    href="mailto:privacy@stigmer.ai"
                    className="text-foreground underline underline-offset-4 hover:opacity-80 transition-opacity"
                  >
                    privacy@stigmer.ai
                  </a>
                  .
                </p>
              </PolicySection>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

interface PolicySectionProps {
  title: string;
  children: React.ReactNode;
}

function PolicySection({ title, children }: PolicySectionProps) {
  return (
    <section>
      <h2 className="text-xl font-bold text-foreground mb-3">{title}</h2>
      {children}
    </section>
  );
}

export { PrivacyPage };
