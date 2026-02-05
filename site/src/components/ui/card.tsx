import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Card container variants.
 */
const cardVariants = cva(
  [
    "rounded-xl",
    "transition-all duration-300",
  ],
  {
    variants: {
      variant: {
        /** Default card with subtle background */
        default: [
          "bg-card border border-border",
          "hover:border-border/80",
        ],
        /** Elevated card with shadow */
        elevated: [
          "bg-card border border-border",
          "shadow-lg shadow-black/20",
          "hover:shadow-xl hover:shadow-black/30",
          "hover:-translate-y-0.5",
        ],
        /** Bordered card with more prominent border */
        bordered: [
          "bg-transparent border-2 border-border",
          "hover:border-primary/50",
        ],
        /** Ghost card - minimal styling */
        ghost: [
          "bg-transparent",
          "hover:bg-muted/50",
        ],
        /** Feature card with glow effect */
        feature: [
          "bg-card/50 border border-border",
          "backdrop-blur-sm",
          "hover:bg-card/80",
          "hover:border-primary/30",
          "hover:shadow-lg hover:shadow-primary/5",
        ],
        /** Glass card with glassmorphism and glow on hover */
        glass: [
          "glass", // Uses CSS utility from globals.css
          "border border-[var(--glass-border)]",
          "hover:border-[var(--glass-border-hover)]",
          "hover:shadow-[var(--glow-primary)]",
        ],
        /** Glass card with accent glow */
        glassAccent: [
          "glass",
          "border border-[var(--glass-border-accent)]",
          "hover:border-[var(--accent)]/40",
          "hover:shadow-[var(--glow-accent)]",
        ],
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

/**
 * Card container component.
 *
 * @example
 * <Card>
 *   <CardHeader>
 *     <CardTitle>Title</CardTitle>
 *     <CardDescription>Description</CardDescription>
 *   </CardHeader>
 *   <CardContent>Content here</CardContent>
 *   <CardFooter>Footer actions</CardFooter>
 * </Card>
 */
const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

/**
 * Card header section - typically contains title and description.
 */
const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

/**
 * Card title - primary heading within a card.
 */
const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight text-foreground",
      className
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

/**
 * Card description - secondary text below the title.
 */
const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

/**
 * Card content - main content area of the card.
 */
const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

/**
 * Card footer - typically contains actions or metadata.
 */
const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  cardVariants,
};
