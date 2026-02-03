"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { NAV_LINKS, SITE_CONFIG } from "@/lib/constants";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
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
 *
 * @example
 * <Header />
 */
function Header({ className, ...props }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

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
            {/* Logo */}
            <Logo showText className="hidden sm:flex" />
            <Logo showText={false} className="sm:hidden" />

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
      />
    </>
  );
}

/**
 * Navigation link with hover/active states.
 */
interface NavLinkProps {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}

function NavLink({ href, external, children }: NavLinkProps) {
  const baseClasses = cn(
    "px-3 py-2 rounded-md",
    "text-sm font-medium",
    "text-muted-foreground",
    "transition-colors",
    "hover:text-foreground hover:bg-muted/50"
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
        <Icon name="external-link" size="xs" className="opacity-50" />
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
