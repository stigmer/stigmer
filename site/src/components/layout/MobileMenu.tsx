"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { NAV_LINKS, SITE_CONFIG } from "@/lib/constants";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export interface MobileMenuProps {
  /**
   * Whether the menu is currently open.
   */
  isOpen: boolean;
  /**
   * Callback to close the menu.
   */
  onClose: () => void;
}

/**
 * Mobile navigation menu with slide-out drawer pattern.
 *
 * Features:
 * - Slide-out animation from right
 * - Backdrop overlay with click-to-close
 * - Body scroll lock when open
 * - Focus trap for accessibility
 * - Escape key to close
 *
 * @example
 * const [isOpen, setIsOpen] = useState(false);
 * <MobileMenu isOpen={isOpen} onClose={() => setIsOpen(false)} />
 */
function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  // Handle escape key
  React.useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  // Lock body scroll when open
  React.useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // Focus management - focus close button when opening
  React.useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      // Small delay to ensure menu is rendered
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Simple focus trap within the menu
  React.useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab" || !menuRef.current) return;

      const focusableElements = menuRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm",
          "transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Menu Panel */}
      <div
        ref={menuRef}
        id="mobile-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "fixed top-0 right-0 bottom-0 z-50",
          "w-full max-w-xs",
          "bg-background border-l border-border",
          "flex flex-col",
          "transform transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-border">
          <Logo showText={false} asLink={false} />
          <Button
            ref={closeButtonRef}
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close navigation menu"
          >
            <Icon name="x" size="lg" />
          </Button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 overflow-y-auto py-4 px-2" aria-label="Mobile navigation">
          <ul className="space-y-1">
            {NAV_LINKS.map((link) => {
              const isExternal = "external" in link && link.external === true;
              return (
                <li key={link.href}>
                  <MobileNavLink
                    href={link.href}
                    external={isExternal}
                    onClick={onClose}
                  >
                    {link.label}
                  </MobileNavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-border">
          <Button asChild className="w-full" size="lg">
            <a
              href={SITE_CONFIG.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="github" />
              <span>View on GitHub</span>
            </a>
          </Button>
        </div>
      </div>
    </>
  );
}

/**
 * Mobile navigation link component.
 */
interface MobileNavLinkProps {
  href: string;
  external?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function MobileNavLink({ href, external, onClick, children }: MobileNavLinkProps) {
  const baseClasses = cn(
    "flex items-center justify-between w-full",
    "px-4 py-3 rounded-lg",
    "text-base font-medium text-foreground",
    "transition-colors",
    "hover:bg-muted"
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={baseClasses}
        onClick={onClick}
      >
        <span>{children}</span>
        <Icon name="external-link" size="sm" className="text-muted-foreground" />
      </a>
    );
  }

  return (
    <Link href={href} className={baseClasses} onClick={onClick}>
      <span>{children}</span>
      <Icon name="chevron-right" size="sm" className="text-muted-foreground" />
    </Link>
  );
}

export { MobileMenu };
