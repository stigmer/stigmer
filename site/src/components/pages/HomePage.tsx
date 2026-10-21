import * as React from "react";
import { cn } from "@/lib/utils";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { SkipLink } from "@/components/ui/skip-link";
import { Hero } from "@/components/sections/Hero";
import { Problem } from "@/components/sections/Problem";
import { AgentGets } from "@/components/sections/AgentGets";
import { HowItFits } from "@/components/sections/HowItFits";
import { UseCases } from "@/components/sections/UseCases";
import { BuiltForPlanton } from "@/components/sections/BuiltForPlanton";
import { OpenSource } from "@/components/sections/OpenSource";
import { FinalCTA } from "@/components/sections/FinalCTA";

export type HomePageProps = React.HTMLAttributes<HTMLDivElement>;

function HomePage({ className, ...props }: HomePageProps) {
  return (
    <div
      className={cn("min-h-screen bg-background overflow-x-hidden", className)}
      {...props}
    >
      <SkipLink />
      <Header />

      <main id="main-content" className="pt-16" tabIndex={-1}>
        <Hero />
        <Problem />
        <AgentGets />
        <HowItFits />
        <UseCases />
        <BuiltForPlanton />
        <OpenSource />
        <FinalCTA />
      </main>

      <Footer />
    </div>
  );
}

export { HomePage };
