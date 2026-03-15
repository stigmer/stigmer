import Link from "next/link";
import { Play, PenLine, ArrowRight, type LucideIcon } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface QuickAction {
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly icon: LucideIcon;
}

const ACTIONS: readonly QuickAction[] = [
  {
    title: "Run Agent",
    description: "Start a new conversation with an agent",
    href: "/run",
    icon: Play,
  },
  {
    title: "Draft Resource",
    description: "Create new resources using AI-powered drafting agents",
    href: "/draft",
    icon: PenLine,
  },
];

export function QuickActions() {
  return (
    <section aria-label="Quick actions">
      <div className="grid gap-4 sm:grid-cols-2">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <Link key={action.href} href={action.href}>
              <Card className="hover:bg-muted/50 h-full transition-colors">
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div className="bg-primary/10 flex size-9 shrink-0 items-center justify-center rounded-lg">
                      <Icon className="text-primary size-4.5" />
                    </div>
                    <div className="flex-1">
                      <CardTitle>{action.title}</CardTitle>
                      <CardDescription>{action.description}</CardDescription>
                    </div>
                    <ArrowRight className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  </div>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
