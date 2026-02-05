"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { NAV_LINKS, SITE_CONFIG } from "@/lib/constants";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeIn } from "@/components/ui/motion";
import { MobileMenu } from "./MobileMenu";

export type HeaderProps = React.HTMLAttributes<HTMLElement>;

/**
 * Site header with fixed positioning, navigation, and mobile menu.
 *
 * Features:
 * - Fixed position with backdrop blur
 * - Responsive navigation (desktop links, mobile drawer)
 * - GitHub CTA button
 * - Accessible markup with proper ARIA attributes
 * - Focus management: returns focus to trigger when mobile menu closes
 *
 * @example
 * <Header />
 */
function Header({ className, ...props }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  // Ref for focus return when mobile menu closes
  const mobileMenuTriggerRef = React.useRef<HTMLButtonElement>(null);

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50",
          "h-16",
          "bg-background/95 backdrop-blur-md",
          "border-b border-border",
          className
        )}
        {...props}
      >
        <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-full flex items-center justify-between">
            {/* Logo - Subtle entrance animation */}
            <FadeIn delay={0}>
              <Logo showText className="hidden sm:flex" />
              <Logo showText={false} className="sm:hidden" />
            </FadeIn>

            {/* Desktop Navigation */}
            <nav
              className="hidden md:flex items-center gap-1"
              aria-label="Main navigation"
            >
              {NAV_LINKS.map((link) => {
                // Skip GitHub in nav links - we have a separate button
                if (link.label === "GitHub") return null;

                const isExternal = "external" in link && link.external === true;

                return (
                  <NavLink key={link.href} href={link.href} external={isExternal}>
                    {link.label}
                  </NavLink>
                );
              })}

              {/* GitHub Button */}
              <Button asChild variant="outline" size="sm" className="ml-2">
                <a
                  href={SITE_CONFIG.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Icon name="github" size="sm" />
                  <span>GitHub</span>
                </a>
              </Button>
            </nav>

            {/* Mobile Menu Trigger */}
            <Button
              ref={mobileMenuTriggerRef}
              variant="ghost"
              size="icon"
              className="md:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-menu"
            >
              <Icon name="menu" size="lg" />
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile Menu */}
      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        triggerRef={mobileMenuTriggerRef}
      />
    </>
  );
}

/**
 * Navigation link with animated underline on hover.
 * 
 * Features:
 * - Pure CSS pseudo-element animation (zero JS overhead)
 * - Uses design token --duration-normal (300ms)
 * - GPU-accelerated width transition
 * - Automatic reduced-motion support via globals.css
 * - Enhanced focus-visible indicator for accessibility (WCAG 2.4.7)
 */
interface NavLinkProps {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}

function NavLink({ href, external, children }: NavLinkProps) {
  const baseClasses = cn(
    // Layout & typography
    "relative px-3 py-2",
    "text-sm font-medium",
    "text-muted-foreground",
    // Border radius for focus ring
    "rounded-sm",
    // Color transition
    "transition-colors",
    "hover:text-foreground",
    // Focus-visible styles for accessibility
    // Uses focus-visible to only show for keyboard navigation, not mouse clicks
    "focus-visible:outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring",
    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "focus-visible:text-foreground",
    // Animated underline pseudo-element
    "after:absolute after:bottom-1 after:left-3 after:right-3",
    "after:h-[2px] after:bg-primary",
    "after:origin-left after:scale-x-0",
    "after:transition-transform after:duration-[var(--duration-normal)] after:ease-out",
    "hover:after:scale-x-100",
    // Show underline on focus too
    "focus-visible:after:scale-x-100"
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(baseClasses, "inline-flex items-center gap-1")}
      >
        {children}
        <Icon name="external-link" size="xs" className="opacity-50" aria-hidden="true" />
        <span className="sr-only">(opens in new tab)</span>
      </a>
    );
  }

  return (
    <Link href={href} className={baseClasses}>
      {children}
    </Link>
  );
}

export { Header };
