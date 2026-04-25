"use client";

import * as React from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { NAV_PRIMARY, NAV_RESOURCES, SITE_CONFIG } from "@/lib/constants";
import {
  backdropFade,
  slideInRightFull,
  staggerContainerFast,
  fadeInUp,
  transitions,
} from "@/lib/animations";
import { AnimatePresence } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { DiscordIcon } from "@/components/ui/discord-icon";

export interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
}

function MobileMenu({ isOpen, onClose, triggerRef }: MobileMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const wasOpen = React.useRef(false);

  React.useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  React.useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (isOpen && closeButtonRef.current) {
      const timer = setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  React.useEffect(() => {
    if (wasOpen.current && !isOpen && triggerRef?.current) {
      const timer = setTimeout(() => {
        triggerRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
    wasOpen.current = isOpen;
  }, [isOpen, triggerRef]);

  React.useEffect(() => {
    if (!isOpen || !menuRef.current) return;

    function handleTab(e: KeyboardEvent) {
      if (e.key !== "Tab" || !menuRef.current) return;

      const focusableElements = menuRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
          <motion.div
            key="backdrop"
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={backdropFade}
            transition={fadeTransition}
            className={cn(
              "fixed inset-0 z-40",
              "bg-foreground/60 backdrop-blur-sm",
            )}
            onClick={onClose}
            aria-hidden="true"
          />

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
              "flex flex-col",
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-end h-16 px-4 border-b border-border">
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
                {/* Primary links */}
                {NAV_PRIMARY.map((link) => (
                  <motion.li
                    key={link.href}
                    variants={fadeInUp}
                    transition={transitions.smooth}
                  >
                    <MobileNavLink href={link.href} onClick={onClose}>
                      {link.label}
                    </MobileNavLink>
                  </motion.li>
                ))}

                {/* Resources group */}
                <motion.li
                  variants={fadeInUp}
                  transition={transitions.smooth}
                >
                  <div
                    className="px-4 pt-4 pb-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground"
                    aria-hidden="true"
                  >
                    {NAV_RESOURCES.label}
                  </div>
                </motion.li>
                {NAV_RESOURCES.items.map((link) => (
                  <motion.li
                    key={link.href}
                    variants={fadeInUp}
                    transition={transitions.smooth}
                  >
                    <MobileNavLink href={link.href} onClick={onClose}>
                      {link.label}
                    </MobileNavLink>
                  </motion.li>
                ))}

                {/* External links */}
                <motion.li
                  variants={fadeInUp}
                  transition={transitions.smooth}
                >
                  <div
                    className="px-4 pt-4 pb-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground"
                    aria-hidden="true"
                  >
                    Community
                  </div>
                </motion.li>
                <motion.li
                  variants={fadeInUp}
                  transition={transitions.smooth}
                >
                  <MobileNavLink
                    href={SITE_CONFIG.githubUrl}
                    external
                    onClick={onClose}
                    icon={<Icon name="github" size="sm" />}
                  >
                    GitHub
                  </MobileNavLink>
                </motion.li>
                <motion.li
                  variants={fadeInUp}
                  transition={transitions.smooth}
                >
                  <a
                    href={SITE_CONFIG.social.discord}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      "flex items-center justify-between w-full",
                      "px-4 py-3 rounded-lg",
                      "text-base font-medium text-foreground",
                      "transition-colors",
                      "hover:bg-muted",
                    )}
                    onClick={onClose}
                  >
                    <span className="inline-flex items-center gap-2">
                      <DiscordIcon size="sm" />
                      Discord
                    </span>
                    <Icon name="external-link" size="sm" className="text-muted-foreground" />
                  </a>
                </motion.li>

              </motion.ul>
            </nav>

            {/* Footer CTA */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, ...transitions.smooth }}
              className="p-4 border-t border-border"
            >
              <Button asChild className="w-full" size="lg">
                <a href={SITE_CONFIG.cloudSignupUrl}>
                  Start Free
                </a>
              </Button>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface MobileNavLinkProps {
  href: string;
  external?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}

function MobileNavLink({
  href,
  external,
  onClick,
  children,
  icon,
}: MobileNavLinkProps) {
  const baseClasses = cn(
    "flex items-center justify-between w-full",
    "px-4 py-3 rounded-lg",
    "text-base font-medium text-foreground",
    "transition-colors",
    "hover:bg-muted",
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
        <span className={icon ? "inline-flex items-center gap-2" : undefined}>
          {icon}
          {children}
        </span>
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
