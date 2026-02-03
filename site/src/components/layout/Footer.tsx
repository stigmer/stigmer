import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FOOTER_LINKS, SITE_CONFIG } from "@/lib/constants";
import { Logo } from "@/components/ui/logo";
import { Icon, type IconName } from "@/components/ui/icon";

export type FooterProps = React.HTMLAttributes<HTMLElement>;

/**
 * Site footer with multi-column navigation and copyright.
 *
 * Features:
 * - Responsive grid layout (4 cols desktop, 2 cols tablet, stacked mobile)
 * - Brand column with logo and tagline
 * - Navigation sections from FOOTER_LINKS constant
 * - External link indicators
 * - MIT license and copyright notice
 *
 * @example
 * <Footer />
 */
function Footer({ className, ...props }: FooterProps) {
  return (
    <footer
      className={cn(
        "bg-card/50 border-t border-border",
        className
      )}
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Main footer content */}
        <div className="py-12 md:py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            {/* Brand Column */}
            <div className="lg:col-span-1">
              <Logo size="md" asLink={false} className="mb-4" />
              <p className="text-sm text-muted-foreground leading-relaxed mb-4">
                {SITE_CONFIG.description}
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icon name="unlock" size="sm" />
                <span>Open source under {SITE_CONFIG.copyright.license}</span>
              </div>
            </div>

            {/* Product Links */}
            <FooterLinkSection title="Product" links={FOOTER_LINKS.product} />

            {/* Resources Links */}
            <FooterLinkSection title="Resources" links={FOOTER_LINKS.resources} />

            {/* Community Links */}
            <FooterLinkSection
              title="Community"
              links={FOOTER_LINKS.community}
              iconMap={{
                GitHub: "github",
                Contributing: "code",
                Issues: "activity",
              }}
            />
          </div>
        </div>

        {/* Bottom bar */}
        <div className="py-6 border-t border-border">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              &copy; {new Date().getFullYear()} {SITE_CONFIG.copyright.holder}.
              All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <a
                href={SITE_CONFIG.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="GitHub repository"
              >
                <Icon name="github" size="md" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Footer link section with title and list of links.
 */
interface FooterLinkSectionProps {
  title: string;
  links: ReadonlyArray<{
    label: string;
    href: string;
    external?: boolean;
  }>;
  /**
   * Optional map of link labels to icon names.
   */
  iconMap?: Record<string, IconName>;
}

function FooterLinkSection({ title, links, iconMap }: FooterLinkSectionProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      <ul className="space-y-3">
        {links.map((link) => (
          <li key={link.href}>
            <FooterLink
              href={link.href}
              external={link.external}
              icon={iconMap?.[link.label]}
            >
              {link.label}
            </FooterLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Individual footer link with optional icon and external indicator.
 */
interface FooterLinkProps {
  href: string;
  external?: boolean;
  icon?: IconName;
  children: React.ReactNode;
}

function FooterLink({ href, external, icon, children }: FooterLinkProps) {
  const baseClasses = cn(
    "inline-flex items-center gap-2",
    "text-sm text-muted-foreground",
    "transition-colors",
    "hover:text-foreground"
  );

  const content = (
    <>
      {icon && <Icon name={icon} size="sm" className="opacity-70" />}
      <span>{children}</span>
      {external && (
        <Icon name="external-link" size="xs" className="opacity-50" />
      )}
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClasses}
      >
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={baseClasses}>
      {content}
    </Link>
  );
}

export { Footer };
