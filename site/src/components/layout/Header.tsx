"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { NAV_LINKS, SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DiscordIcon } from "@/components/ui/discord-icon";
import { MobileMenu } from "./MobileMenu";

export type HeaderProps = React.HTMLAttributes<HTMLElement>;

function Header({ className, ...props }: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const mobileMenuTriggerRef = React.useRef<HTMLButtonElement>(null);

  return (
    <>
      <header
        className={cn(
          "fixed top-0 left-0 right-0 z-50",
          "h-16",
          "bg-[rgba(10,10,10,0.88)] backdrop-blur-md",
          "border-b border-border",
          className
        )}
        {...props}
      >
        <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="h-full flex items-center justify-between">
            {/* Logo */}
            <Link
              href="/"
              className="inline-flex items-center transition-opacity hover:opacity-80"
              aria-label={`${SITE_CONFIG.name} - Go to homepage`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/Icon-bw.svg"
                alt="Stigmer"
                className="w-10 h-10"
              />
            </Link>

            {/* Desktop Navigation */}
            <nav
              className="hidden md:flex items-center gap-1"
              aria-label="Main navigation"
            >
              {NAV_LINKS.map((link) => {
                const isExternal = "external" in link && link.external === true;
                return (
                  <NavLink key={link.href} href={link.href} external={isExternal}>
                    {link.label}
                  </NavLink>
                );
              })}

              <div className="ml-3 flex items-center gap-2">
                <a
                  href={SITE_CONFIG.social.discord}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <DiscordIcon size="md" />
                  Discord
                </a>
                <Button asChild variant="ghost" size="sm">
                  <a href={SITE_CONFIG.cloudSigninUrl}>
                    Sign In
                  </a>
                </Button>
                <Button asChild size="sm">
                  <a href={SITE_CONFIG.cloudSignupUrl}>
                    Start Free
                  </a>
                </Button>
              </div>
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

      <MobileMenu
        isOpen={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        triggerRef={mobileMenuTriggerRef}
      />
    </>
  );
}

interface NavLinkProps {
  href: string;
  external?: boolean;
  children: React.ReactNode;
}

function NavLink({ href, external, children }: NavLinkProps) {
  const baseClasses = cn(
    "relative px-3 py-2",
    "text-sm font-medium",
    "text-muted-foreground",
    "rounded-sm",
    "transition-colors",
    "hover:text-foreground",
    "focus-visible:outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring",
    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "focus-visible:text-foreground",
    "after:absolute after:bottom-1 after:left-3 after:right-3",
    "after:h-px after:bg-foreground",
    "after:origin-left after:scale-x-0",
    "after:transition-transform after:duration-[var(--duration-normal)] after:ease-out",
    "hover:after:scale-x-100",
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
