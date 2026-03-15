import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";

interface TopBarProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

export function TopBar({
  title,
  description,
  actions,
  breadcrumbs,
}: TopBarProps) {
  return (
    <header className="flex flex-col gap-2 pb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <Breadcrumb items={breadcrumbs} />
      )}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && (
            <p className="text-muted-foreground text-sm">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
