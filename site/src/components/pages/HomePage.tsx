import * as React from "react";
import { cn } from "@/lib/utils";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SkipLink } from "@/components/ui/skip-link";
import { Hero } from "@/components/sections/Hero";
import { Features } from "@/components/sections/Features";
import { Architecture } from "@/components/sections/Architecture";
import { Quickstart } from "@/components/sections/Quickstart";

export type HomePageProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * HomePage composition - assembles all landing page sections.
 *
 * Structure:
 * - Skip link (accessibility - first focusable element)
 * - Header (fixed, with navigation)
 * - Main content (with pt-16 offset for fixed header)
 *   - Hero section
 *   - Features section
 *   - Architecture section
 *   - Quickstart section
 * - Footer
 *
 * @example
 * // In app/page.tsx
 * import { HomePage } from "@/components/pages/HomePage";
 * export default function Page() {
 *   return <HomePage />;
 * }
 */
function HomePage({ className, ...props }: HomePageProps) {
  return (
    <div
      className={cn("min-h-screen bg-background", className)}
      {...props}
    >
      {/* Skip Link - First focusable element for keyboard accessibility */}
      <SkipLink />

      {/* Fixed Header */}
      <Header />

      {/* Main Content - Target for skip link */}
      <main id="main-content" className="pt-16" tabIndex={-1}>
        {/* Hero Section */}
        <Hero />

        {/* Features Section */}
        <Features />

        {/* Architecture Section */}
        <Architecture />

        {/* Quickstart Section */}
        <Quickstart />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export { HomePage };
