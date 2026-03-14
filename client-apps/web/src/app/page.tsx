import Link from "next/link";
import {
  Play,
  Bot,
  PenLine,
  ArrowRight,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { TopBar } from "@/components/layout/TopBar";
import { RecentSessions } from "@/components/dashboard/RecentSessions";

const QUICK_ACTIONS = [
  {
    title: "Run Agent",
    description: "Start a new conversation with an agent",
    href: "/run",
    icon: Play,
  },
  {
    title: "Browse Catalog",
    description: "Explore agents, skills, and MCP servers",
    href: "/agents",
    icon: Bot,
  },
  {
    title: "Draft Resource",
    description: "Create new resources using AI-powered drafting agents",
    href: "/draft",
    icon: PenLine,
  },
] as const;

export default function DashboardPage() {
  return (
    <>
      <TopBar
        title="Dashboard"
        description="Quick actions — run agents, browse the catalog, draft resources"
      />

      <div className="space-y-8">
        <div className="grid gap-4 sm:grid-cols-3">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.href} href={action.href}>
                <Card className="h-full transition-colors hover:bg-muted/50">
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="size-4.5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <CardTitle>{action.title}</CardTitle>
                        <CardDescription>{action.description}</CardDescription>
                      </div>
                      <ArrowRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>

        <RecentSessions />
      </div>
    </>
  );
}
