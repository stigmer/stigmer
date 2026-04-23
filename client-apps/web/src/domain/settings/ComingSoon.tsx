import type { ComponentType } from "react";
import { Construction } from "lucide-react";

interface ComingSoonProps {
  readonly title: string;
  readonly icon?: ComponentType<{ className?: string }>;
}

export function ComingSoon({ title, icon: Icon = Construction }: ComingSoonProps) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <Icon className="text-muted-foreground mb-4 size-10" />
      <h2 className="text-foreground mb-2 text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground text-sm">
        This feature is coming soon.
      </p>
    </div>
  );
}
