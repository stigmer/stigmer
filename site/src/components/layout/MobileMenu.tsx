"use client";

/**
 * Mobile Navigation Menu
 *
 * A slide-out drawer pattern with proper accessibility and animations.
 *
 * Features:
 * - Framer Motion AnimatePresence for smooth enter/exit
 * - Backdrop overlay with click-to-close
 * - Body scroll lock when open
 * - Focus trap for accessibility
 * - Escape key to close
 * - Respects reduced motion preference
 */

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { NAV_LINKS, SITE_CONFIG } from "@/lib/constants";
import {
  backdropFade,
  slideInRightFull,
  staggerContainerFast,
  fadeInUp,
  transitions,
} from "@/lib/animations";
import { AnimatePresence } from "@/components/ui/motion";
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
 * @example
 * const [isOpen, setIsOpen] = useState(false);
 * <MobileMenu isOpen={isOpen} onClose={() => setIsOpen(false)} />
 */
function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const prefersReducedMotion = useReducedMotion();

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

  // Determine transition based on motion preference
  const menuTransition = prefersReducedMotion
    ? { duration: 0 }
    : transitions.menu;
  const fadeTransition = prefersReducedMotion
    ? { duration: 0 }
    : transitions.fast;

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={backdropFade}
            transition={fadeTransition}
            className={cn(
              "fixed inset-0 z-40",
              "bg-black/60 backdrop-blur-sm"
            )}
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Menu Panel */}
          <motion.div
            ref={menuRef}
            key="panel"
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={slideInRightFull}
            transition={menuTransition}
            className={cn(
              "fixed top-0 right-0 bottom-0 z-50",
              "w-full max-w-xs",
              "bg-background border-l border-border",
              "flex flex-col"
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
            <nav
              className="flex-1 overflow-y-auto py-4 px-2"
              aria-label="Mobile navigation"
            >
              <motion.ul
                initial="hidden"
                animate="visible"
                variants={staggerContainerFast}
                className="space-y-1"
              >
                {NAV_LINKS.map((link) => {
                  const isExternal =
                    "external" in link && link.external === true;
                  return (
                    <motion.li
                      key={link.href}
                      variants={fadeInUp}
                      transition={transitions.smooth}
                    >
                      <MobileNavLink
                        href={link.href}
                        external={isExternal}
                        onClick={onClose}
                      >
                        {link.label}
                      </MobileNavLink>
                    </motion.li>
                  );
                })}
              </motion.ul>
            </nav>

            {/* Footer */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, ...transitions.smooth }}
              className="p-4 border-t border-border"
            >
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
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
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

function MobileNavLink({
  href,
  external,
  onClick,
  children,
}: MobileNavLinkProps) {
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
