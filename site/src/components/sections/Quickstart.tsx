"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { FadeInUp } from "@/components/ui/motion";

export type QuickstartProps = React.HTMLAttributes<HTMLElement>;

function Quickstart({ className, ...props }: QuickstartProps) {
  return (
    <section
      id="quickstart"
      className={cn("py-24 sm:py-32", className)}
      aria-labelledby="quickstart-heading"
      {...props}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center">
            <h2
              id="quickstart-heading"
              className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-4"
            >
              <span className="bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
                Get Started
              </span>
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
              Quickstart guides and tutorials are being written.
            </p>
            <Button asChild size="lg">
              <Link href="/docs">
                <Icon name="book-open" />
                Documentation
              </Link>
            </Button>
          </div>
        </FadeInUp>
      </div>
    </section>
  );
}

export { Quickstart };
