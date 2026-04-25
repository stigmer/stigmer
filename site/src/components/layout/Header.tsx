"use client";

import * as React from "react";
import Link from "next/link";
import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";
import { NAV_PRIMARY, NAV_RESOURCES, SITE_CONFIG } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DiscordIcon } from "@/components/ui/discord-icon";
import { MobileMenu } from "./MobileMenu";

export type HeaderProps = React.HTMLAttributes<HTMLElement>;

const navLinkClasses = cn(
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
  "focus-visible:after:scale-x-100",
);

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
          className,
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
              {NAV_PRIMARY.map((link) => (
                <NavLink key={link.href} href={link.href}>
                  {link.label}
                </NavLink>
              ))}

              <ResourcesDropdown />

              <div className="ml-3 flex items-center gap-2">
                <a
                  href={SITE_CONFIG.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "inline-flex items-center justify-center",
                    "w-9 h-9 rounded-md",
                    "text-muted-foreground transition-colors hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                  aria-label="GitHub repository"
                >
                  <Icon name="github" size="md" />
                </a>
                <a
                  href={SITE_CONFIG.social.discord}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "inline-flex items-center justify-center",
                    "w-9 h-9 rounded-md",
                    "text-muted-foreground transition-colors hover:text-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                  aria-label="Discord community"
                >
                  <DiscordIcon size="md" />
                </a>

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

// ---------------------------------------------------------------------------
// Resources dropdown (Header-specific, not a shared primitive)
// ---------------------------------------------------------------------------

function ResourcesDropdown() {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        className={cn(
          navLinkClasses,
          "inline-flex items-center gap-1 cursor-pointer",
          "data-[popup-open]:text-foreground",
        )}
      >
        {NAV_RESOURCES.label}
        <Icon
          name="chevron-down"
          size="xs"
          className={cn(
            "transition-transform duration-200",
            "[[data-popup-open]>&]:rotate-180",
          )}
        />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner side="bottom" align="center" sideOffset={8}>
          <Menu.Popup
            className={cn(
              "min-w-[10rem] py-1.5",
              "bg-background border border-border rounded-lg",
              "shadow-lg shadow-black/20",
              "origin-[var(--transform-origin)]",
              "transition-[transform,scale,opacity] duration-200",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
            )}
          >
            {NAV_RESOURCES.items.map((item) => (
              <Menu.LinkItem
                key={item.href}
                href={item.href}
                closeOnClick
                render={<Link href={item.href} />}
                className={cn(
                  "flex items-center w-full px-3 py-2",
                  "text-sm font-medium text-muted-foreground",
                  "transition-colors",
                  "hover:text-foreground hover:bg-muted",
                  "data-[highlighted]:text-foreground data-[highlighted]:bg-muted",
                  "focus-visible:outline-none",
                )}
              >
                {item.label}
              </Menu.LinkItem>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// ---------------------------------------------------------------------------
// NavLink (top-level internal links)
// ---------------------------------------------------------------------------

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
}

function NavLink({ href, children }: NavLinkProps) {
  return (
    <Link href={href} className={navLinkClasses}>
      {children}
    </Link>
  );
}

export { Header };
