import * as React from "react";
import { cn } from "@/lib/utils";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/sections/Hero";
import { Features } from "@/components/sections/Features";
import { Quickstart } from "@/components/sections/Quickstart";

export type HomePageProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * HomePage composition - assembles all landing page sections.
 *
 * Structure:
 * - Header (fixed, with navigation)
 * - Main content (with pt-16 offset for fixed header)
 *   - Hero section
 *   - Features section
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
      {/* Fixed Header */}
      <Header />

      {/* Main Content */}
      <main className="pt-16">
        {/* Hero Section */}
        <Hero />

        {/* Features Section */}
        <Features />

        {/* Quickstart Section */}
        <Quickstart />
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}

export { HomePage };
