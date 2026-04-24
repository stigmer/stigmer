import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import {
  FileCode,
  Terminal,
  Cpu,
  Code,
  Activity,
  Unlock,
  Lock,
  Github,
  BookOpen,
  ExternalLink,
  Menu,
  X,
  ChevronRight,
  Copy,
  Check,
  Network,
  Lightbulb,
  Package,
  ArrowRight,
  Shield,
  Download,
  Monitor,
  type LucideIcon,
} from "lucide-react";

/**
 * Map of icon names to their Lucide components.
 * Add new icons here as needed.
 */
const iconMap = {
  "file-code": FileCode,
  terminal: Terminal,
  cpu: Cpu,
  code: Code,
  activity: Activity,
  unlock: Unlock,
  lock: Lock,
  github: Github,
  "book-open": BookOpen,
  "external-link": ExternalLink,
  menu: Menu,
  x: X,
  "chevron-right": ChevronRight,
  copy: Copy,
  check: Check,
  network: Network,
  lightbulb: Lightbulb,
  package: Package,
  "arrow-right": ArrowRight,
  shield: Shield,
  download: Download,
  monitor: Monitor,
} as const;

/**
 * Union type of all available icon names.
 */
export type IconName = keyof typeof iconMap;

/**
 * Icon size variants using class-variance-authority.
 */
const iconVariants = cva("shrink-0", {
  variants: {
    size: {
      xs: "w-3 h-3",
      sm: "w-4 h-4",
      md: "w-5 h-5",
      lg: "w-6 h-6",
      xl: "w-8 h-8",
    },
  },
  defaultVariants: {
    size: "md",
  },
});

export interface IconProps
  extends Omit<React.SVGAttributes<SVGElement>, "name">,
    VariantProps<typeof iconVariants> {
  /**
   * The name of the icon to render.
   */
  name: IconName;
}

/**
 * Type-safe icon component wrapping Lucide icons.
 * Provides consistent sizing and styling across the application.
 *
 * @example
 * // Default medium size
 * <Icon name="github" />
 *
 * @example
 * // Large terminal icon
 * <Icon name="terminal" size="lg" />
 *
 * @example
 * // With custom className
 * <Icon name="check" className="text-green-500" />
 */
function Icon({ name, size, className, ...props }: IconProps) {
  const IconComponent = iconMap[name];

  if (!IconComponent) {
    console.warn(`Icon "${name}" not found in icon map`);
    return null;
  }

  return (
    <IconComponent
      className={cn(iconVariants({ size }), className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * Helper to get the raw Lucide component for cases where
 * you need direct access (e.g., for animations).
 */
function getIconComponent(name: IconName): LucideIcon | undefined {
  return iconMap[name];
}

/**
 * List of all available icon names for documentation.
 */
const availableIcons = Object.keys(iconMap) as IconName[];

export { Icon, iconVariants, getIconComponent, availableIcons };
