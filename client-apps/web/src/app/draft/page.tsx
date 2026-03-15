import Link from "next/link";
import { PenLine, ArrowRight } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { ALL_DRAFT_CONFIGS } from "@/config/draft";

export default function DraftLandingPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <PenLine className="text-primary size-5" />
        <div>
          <h1 className="text-lg font-semibold">Draft</h1>
          <p className="text-muted-foreground text-sm">
            Create new resources using AI-powered drafting agents
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl p-6">
        <div className="grid gap-4">
          {ALL_DRAFT_CONFIGS.map((draft) => {
            const Icon = draft.icon;
            return (
              <Link key={draft.type} href={draft.href}>
                <Card className="hover:bg-muted/50 transition-colors">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="bg-primary/10 flex size-9 items-center justify-center rounded-lg">
                        <Icon className="text-primary size-4.5" />
                      </div>
                      <div className="flex-1">
                        <CardTitle>{draft.title}</CardTitle>
                        <CardDescription>{draft.description}</CardDescription>
                      </div>
                      <ArrowRight className="text-muted-foreground size-4" />
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
