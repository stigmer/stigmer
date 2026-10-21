"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SITE_CONFIG } from "@/lib/constants";
import { Icon } from "@/components/ui/icon";
import { FadeInUp } from "@/components/ui/motion";

export type OpenSourceProps = React.HTMLAttributes<HTMLElement>;

const LINKS = [
  { label: "Run it on your servers", href: "/docs/guides/self-hosting/overview" },
  { label: "Compare editions", href: "/docs/guides/self-hosting/cloud-vs-self-hosted" },
  { label: "Pricing", href: "/pricing" },
];

function OpenSource({ className, ...props }: OpenSourceProps) {
  return (
    <section
      id="open-source"
      className={cn("py-24 sm:py-32 border-t border-border", className)}
      aria-labelledby="open-source-heading"
      {...props}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <FadeInUp>
          <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
            Open source
          </p>
          <h2
            id="open-source-heading"
            className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6"
          >
            Open source, on your servers or ours
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8 leading-relaxed">
            Stigmer&apos;s core is Apache 2.0. Run it on your own servers, or use Stigmer Cloud. The
            editions say what each includes.
          </p>
        </FadeInUp>

        <FadeInUp delay={0.1}>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            <a
              href={SITE_CONFIG.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-foreground hover:text-foreground/80 transition-colors"
            >
              <Icon name="github" size="sm" />
              View source
            </a>
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {link.label}
                <Icon name="arrow-right" size="xs" />
              </Link>
            ))}
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

export { OpenSource };
