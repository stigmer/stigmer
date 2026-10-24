"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FadeInUp } from "@/components/ui/motion";

export type ProblemProps = React.HTMLAttributes<HTMLElement>;

/** What a team would build for itself, beside what Stigmer gives each customer's agent. */
const ROWS: readonly { build: string; gives: React.ReactNode }[] = [
  { build: "A sandbox you run yourself", gives: "Each customer's agent has its own computer" },
  {
    build: "Request-length calls, queues and retries you wrote",
    gives: "It works on a job for hours and survives restarts",
  },
  { build: "Hand-rolled approval flags", gives: "It asks before acting on what you mark" },
  {
    build: "Tenant checks in your own code",
    gives: (
      <>
        Each customer&apos;s agents, files and keys stay apart (
        <Link
          href="/docs/getting-started/one-organization-per-customer"
          className="text-foreground underline underline-offset-4 hover:text-foreground/80"
        >
          how, by edition
        </Link>
        )
      </>
    ),
  },
  {
    build: "A hosted vendor that holds your keys and data",
    gives: "Your model keys, on your servers or ours",
  },
];

function Problem({ className, ...props }: ProblemProps) {
  return (
    <section
      id="problem"
      className={cn("py-24 sm:py-32", className)}
      aria-labelledby="problem-heading"
      {...props}
    >
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <FadeInUp>
          <div className="text-center mb-16">
            <p className="text-xs font-mono uppercase tracking-wider text-subtle mb-4">
              The problem
            </p>
            <h2
              id="problem-heading"
              className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground mb-6"
            >
              Your customers want an agent that does the work. The machinery is the hard part.
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              A chat window on a model API answers questions. An agent that does a job for each of
              your customers needs a computer to work on, hours to finish the job, a way to ask
              before it acts, and walls between one customer and the next. Most teams end up
              building that themselves.
            </p>
          </div>
        </FadeInUp>

        <FadeInUp delay={0.1}>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th
                  scope="col"
                  className="w-1/2 py-3 pr-4 text-left text-xs font-mono font-normal uppercase tracking-wider text-subtle"
                >
                  What you&apos;d build
                </th>
                <th
                  scope="col"
                  className="w-1/2 py-3 pl-4 text-left text-xs font-mono font-normal uppercase tracking-wider text-subtle"
                >
                  What Stigmer gives you
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.build} className="border-b border-border align-top">
                  <td className="py-4 pr-4 text-muted-foreground leading-relaxed">{row.build}</td>
                  <td className="py-4 pl-4 text-foreground leading-relaxed">{row.gives}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </FadeInUp>
      </div>
    </section>
  );
}

export { Problem };
