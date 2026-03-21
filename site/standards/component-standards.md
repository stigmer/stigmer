# Component Standards

This document defines the naming conventions, required props, styling rules, animation patterns, responsive requirements, and accessibility criteria for marketing components in `site/src/components/`.

These standards apply to **new components and modifications to existing components**. Existing code is not required to be retroactively compliant — it is audited only when touched. See [Current Component Audit](#current-component-audit) for a snapshot of existing inconsistencies.

For the broader website rules that govern content, copy, performance, and SEO, see [`website-standards.md`](website-standards.md).

---

## Component Taxonomy

Components follow an atomic design hierarchy. Each level has a defined responsibility, location, and complexity ceiling.

### Atoms — `site/src/components/ui/`

Single-responsibility primitives. No business logic. Variant-driven via `cva`.

| Characteristic | Requirement |
|---|---|
| Responsibility | One visual job (render a button, display a badge, highlight code) |
| Business logic | None — atoms are pure presentation |
| Variant system | `cva` with a `variants` record for visual variations |
| Composition | Accepts `children` or explicit content props, never both |
| State | Stateless, or minimal internal state (e.g., copy-to-clipboard toggle) |

Examples: `Button`, `Badge`, `CodeBlock`, `Icon`, `Logo`, `SkipLink`.

### Molecules — `site/src/components/ui/` or `site/src/components/sections/`

Composed from atoms. One semantic job. May introduce layout but not page structure.

| Characteristic | Requirement |
|---|---|
| Responsibility | One semantic job combining multiple atoms (a feature card, a CTA band, a comparison row) |
| Composition | Assembles 2+ atom types into a meaningful unit |
| State | May manage local interaction state (hover, expand, toggle) |
| Data | Receives data via props — does not fetch |

Decision boundary: if the component renders children from different atom types (e.g., an `Icon` + text + `Badge` inside a card), it is a molecule.

Examples: `FeatureCard`, `CTABand`, `ComparisonRow`, `QuickstartStep`.

### Organisms — `site/src/components/sections/`

Full-width page sections. Own a scroll-anchor `id`. Use stagger animations for child entrance.

| Characteristic | Requirement |
|---|---|
| Responsibility | A complete page section with a defined funnel job |
| Width | Full viewport width (content constrained by `max-w-7xl`) |
| Anchor | Must provide an `id` for section-anchor navigation |
| Heading | Must contain a semantic heading (`<h2>`) with a corresponding `aria-labelledby` |
| Animation | Uses `StaggerContainer` + `StaggerItem` for orchestrated entrance |

Decision boundary: if the component owns a scroll-anchor `id` and occupies full viewport width, it is an organism.

Examples: `Hero`, `Features`, `Architecture`, `Quickstart`.

### Pages — `site/src/components/pages/`

Composition shells that assemble organisms into a page. Minimal logic.

| Characteristic | Requirement |
|---|---|
| Responsibility | Assemble sections in the correct order per the page template |
| Logic | Minimal — pass data to sections, define the `<h1>`, set metadata context |
| Sections | Ordered according to `site/standards/templates/{page-type}.md` |
| One per route | Each page component maps to exactly one Next.js route |

The Next.js route file (`app/{route}/page.tsx`) is a thin wrapper that imports the page component and exports metadata. Route files contain no layout or presentation logic.

Examples: `HomePage`, `UseCasePage`, `ComparisonPage`, `FeaturePage`.

---

## Naming Conventions

Naming follows the established patterns already in use across the codebase.

### Files

| Context | Convention | Examples |
|---|---|---|
| Component files | `kebab-case.tsx` | `code-block.tsx`, `skip-link.tsx`, `feature-card.tsx` |
| Utility files | `kebab-case.ts` | `animations.ts`, `utils.ts` |
| Page components | `PascalCase.tsx` | `HomePage.tsx`, `UseCasePage.tsx` |
| Section components | `PascalCase.tsx` | `Hero.tsx`, `Features.tsx` |

Page and section components use PascalCase filenames because they are singletons — there is one `Hero.tsx`, not a reusable `hero.tsx` that is instantiated with different configs. Atoms and molecules use kebab-case because they are reusable building blocks.

### Components

| Context | Convention | Examples |
|---|---|---|
| Component names | PascalCase | `CodeBlock`, `FeatureCard`, `HeroSection` |
| Props types | `{ComponentName}Props` | `ButtonProps`, `CardProps`, `HeroProps` |
| Event handler props | `on{Event}` | `onClose`, `onClick`, `onCopy` |
| Boolean props | `is{State}` or bare adjective | `isOpen`, `disabled`, `asChild` |
| Render prop / slot | `render{Thing}` or `{thing}Slot` | `renderIcon`, `actionSlot` |

### Internal Components

Unexported subcomponents live in the same file as their parent. They are not exported from barrel files.

```
// Features.tsx
export function Features({ ... }) { ... }

// Internal — not exported
function FeatureCard({ ... }) { ... }
```

This keeps the public API surface small. If an internal component is needed elsewhere, extract it to its own file and promote it to the appropriate taxonomy level.

### Variant Definitions

Variant objects are named `{componentName}Variants` and defined above the component using `cva`:

```
const badgeVariants = cva(/* base */, { variants: { ... } });
```

This matches the established pattern in `button.tsx`, `card.tsx`, `badge.tsx`, `icon.tsx`, and `logo.tsx`.

---

## Required Props Interface

Every marketing component must accept a minimum set of props for composition, linking, and accessibility.

### All Components

| Prop | Type | Purpose |
|---|---|---|
| `className` | `string?` | Composition — allows parent components to inject layout or override classes via `cn()` |
| `id` | `string?` | Anchor linking, testing selectors, `aria-labelledby` targets |
| HTML attributes | `React.HTMLAttributes<HTMLElement>` | Spread via `...props` for flexibility |

Implementation pattern (using `Button` as the canonical example):

```tsx
export interface FeatureCardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof featureCardVariants> {
  title: string;
  description: string;
  icon: ReactNode;
}

const FeatureCard = React.forwardRef<HTMLDivElement, FeatureCardProps>(
  ({ className, title, description, icon, ...props }, ref) => {
    return (
      <div ref={ref} className={cn(featureCardVariants(), className)} {...props}>
        {/* ... */}
      </div>
    );
  }
);
FeatureCard.displayName = "FeatureCard";
```

### Organisms (Sections)

In addition to the base props, organisms must provide:

| Requirement | Detail |
|---|---|
| Default `id` | Every section must have a stable `id` for anchor navigation (e.g., `id="features"`) |
| `aria-labelledby` | Points to the section's heading element |
| Heading element | Must contain a `<h2>` (or `<h1>` for hero in page context) with a matching `id` |

Pattern:

```tsx
<section id="features" aria-labelledby="features-heading" className={cn("py-24", className)} {...props}>
  <h2 id="features-heading">...</h2>
  {/* section content */}
</section>
```

### forwardRef and displayName

Components that render a single DOM element should use `forwardRef` for ref forwarding. Every `forwardRef` component must set `displayName` for DevTools and error messages:

```tsx
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, ...props }, ref) => { /* ... */ }
);
Button.displayName = "Button";
```

---

## Styling Rules

### Tailwind Utilities Only

Use Tailwind utility classes for all styling. No arbitrary values.

| Allowed | Prohibited |
|---|---|
| `text-sm`, `text-base`, `text-lg` | `text-[11px]`, `text-[0.6875rem]` |
| `w-10`, `w-12`, `w-full` | `w-[347px]`, `w-[calc(100%-2rem)]` |
| `gap-4`, `gap-6` | `gap-[18px]` |
| `py-16`, `py-24` | `py-[100px]` |

If a design requires a value that is not on the Tailwind scale, the design needs adjustment — not a custom value.

### Design Tokens

All colors must use CSS custom properties from `globals.css`. Hardcoded values are prohibited.

| Allowed | Prohibited |
|---|---|
| `text-primary`, `bg-background` | `text-blue-500`, `bg-gray-900` |
| `border-border`, `text-muted-foreground` | `border-gray-700`, `text-gray-400` |
| `var(--primary)` in CSS | `rgba(59,130,246,0.5)`, `#3b82f6` |

**Token inventory** (from `globals.css`):

| Category | Tokens |
|---|---|
| Core | `--background`, `--foreground`, `--primary`, `--primary-foreground`, `--secondary`, `--secondary-foreground`, `--accent`, `--accent-foreground` |
| Muted | `--muted`, `--muted-foreground` |
| Surfaces | `--card`, `--card-foreground`, `--popover`, `--popover-foreground` |
| Borders | `--border`, `--input`, `--ring` |
| State | `--destructive`, `--destructive-foreground` |
| Glass | `--glass-bg`, `--glass-bg-strong`, `--glass-bg-subtle`, `--glass-border`, `--glass-border-hover`, `--glass-border-accent`, `--glass-blur`, `--glass-blur-strong`, `--glass-blur-subtle` |
| Glow | `--glow-sm`, `--glow-md`, `--glow-lg`, `--glow-primary`, `--glow-primary-intense`, `--glow-accent`, `--glow-accent-intense` |
| Duration | `--duration-instant`, `--duration-fast`, `--duration-normal`, `--duration-slow`, `--duration-slower` |
| Layout | `--radius` |

Utility classes from `globals.css` for surface effects: `.glass`, `.glass-strong`, `.glass-subtle`, `.glow-on-hover`, `.glow-on-hover-accent`, `.glow-on-hover-intense`, `.glow-primary`, `.glow-accent`.

### Variant System

Multi-variant components use `cva` (class-variance-authority) to define variant combinations. This is the canonical pattern established by `button.tsx`:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const cardVariants = cva(
  // Base styles applied to all variants
  ["rounded-lg border transition-colors"],
  {
    variants: {
      variant: {
        default: "bg-card border-border",
        glass: "glass border-glass-border",
        feature: "bg-card/50 border-primary/20",
      },
      size: {
        sm: "p-4",
        md: "p-6",
        lg: "p-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);
```

The props interface extends `VariantProps<typeof cardVariants>` to get type-safe variant props.

### cn() Merging

Always use `cn()` from `@/lib/utils` for conditional class composition. It resolves Tailwind conflicts correctly:

```tsx
// cn() resolves px-4 vs px-6 conflict — px-6 wins
<div className={cn("px-4 py-2", isLarge && "px-6", className)} />
```

Never concatenate class strings manually. Never use template literals for conditional classes.

### No Inline Styles

The `style` attribute is prohibited except for values that must be computed at runtime:

| Allowed | Prohibited |
|---|---|
| `style={{ width: `${progress}%` }}` (runtime-computed) | `style={{ color: '#3b82f6' }}` (static value) |
| `style={{ transform: `translateX(${offset}px)` }}` | `style={{ padding: '24px' }}` (use Tailwind) |

### Dark Theme First

The site uses a dark theme by default. All components are authored for the dark theme. If a light theme is added in the future, it must be implemented via CSS custom property overrides — not by adding conditional light/dark classes throughout components.

---

## Animation Rules

All animations use the centralized system from `lib/animations.ts` and `components/ui/motion.tsx`.

### Variants

Use the exported variant objects from `lib/animations.ts`:

| Variant | Use For |
|---|---|
| `fadeInUp` | Section entrance on scroll (the workhorse animation) |
| `fadeInDown` | Dropdown menus, tooltips, elements entering from above |
| `fadeIn` | Subtle content reveals, overlays, backdrops |
| `scaleIn` | Cards with emphasis, modals, focused elements |
| `slideInRight` / `slideInLeft` | Side drawers, panels |
| `slideInRightFull` | Mobile navigation drawer |
| `backdropFade` | Modal backdrops, menu overlays |

### Stagger Containers

For orchestrated child animations, use the stagger variants:

| Container | Timing | Use For |
|---|---|---|
| `staggerContainer` | 0.1s stagger, 0.1s delay | Feature grids, card collections |
| `staggerContainerFast` | 0.05s stagger, 0.05s delay | Navigation items, quick lists |
| `staggerContainerSlow` | 0.15s stagger, 0.2s delay | Hero sections, important content |

### Transitions

Use transition presets from `transitions` in `lib/animations.ts`. Never write inline `duration` or `ease` values.

| Preset | Type | Use For |
|---|---|---|
| `transitions.spring` | Spring (300/30) | Natural, professional feel |
| `transitions.springBouncy` | Spring (400/25) | Playful interactions |
| `transitions.springGentle` | Spring (200/30) | Subtle, restrained |
| `transitions.smooth` | Tween (0.4s) | Standard entrance (paired with `fadeInUp`) |
| `transitions.fast` | Tween (0.2s) | Quick interactions (hover, toggle) |
| `transitions.slow` | Tween (0.6s) | Dramatic reveals |
| `transitions.menu` | Spring (400/40) | Drawer/menu open-close |

### Wrapper Components

Prefer the declarative wrapper components from `motion.tsx` over raw `motion.div`:

| Component | Wraps | Default Variant |
|---|---|---|
| `FadeInUp` | `motion.div` | `fadeInUp` + `transitions.smooth` |
| `FadeIn` | `motion.div` | `fadeIn` + `transitions.smooth` |
| `ScaleIn` | `motion.div` | `scaleIn` + `transitions.spring` |
| `StaggerContainer` | `motion.div` | Custom stagger from props |
| `StaggerItem` | `motion.div` | `fadeInUp` + `transitions.smooth` |
| `MotionDiv` | `motion.div` | None — fully custom |

All wrapper components:
- Accept `disabled` prop to skip animations programmatically.
- Respect `useReducedMotion()` — when the user prefers reduced motion, they render a static `<div>`.
- Accept `variants` override to substitute a different animation.
- Forward `ref` and `className`.

Use `MotionDiv` only when the pre-built components do not fit. Document why the custom animation is needed.

### Viewport Triggers

For scroll-triggered animations, use `viewportSettings` from `lib/animations.ts`:

| Setting | Behavior | Use For |
|---|---|---|
| `viewportSettings.standard` | Animate once, 100px before visible | Default for all sections |
| `viewportSettings.eager` | Animate once, immediately on visible | Above-fold content |
| `viewportSettings.lazy` | Animate once, 200px before visible | Below-fold, less important |
| `viewportSettings.repeat` | Re-animate on every scroll | Rarely — use with restraint |

### GPU-Composited Only

Animations must only target `transform` and `opacity`. These properties are GPU-composited and do not trigger layout recalculations.

| Allowed | Prohibited |
|---|---|
| `opacity`, `x`, `y`, `scale`, `rotate` | `width`, `height`, `top`, `left`, `margin`, `padding` |

### Reduced Motion

The `globals.css` media query globally disables transitions and animations when `prefers-reduced-motion: reduce` is set. Do not override this.

Components that add runtime motion (via Framer Motion) must also check `useReducedMotion()`:

```tsx
const prefersReducedMotion = useReducedMotion();
if (prefersReducedMotion) {
  return <div className={className}>{children}</div>;
}
```

The wrapper components in `motion.tsx` handle this automatically. Only check `useReducedMotion()` manually when using raw `motion.div`.

### Adding New Animations

If an animation is needed that does not exist in `lib/animations.ts`, add it to the library first, then consume it from the component. Never define inline variant objects or transition configs in component files.

Process:
1. Define the variant in `lib/animations.ts` with a JSDoc comment explaining its use case.
2. If it needs a wrapper component, add it to `motion.tsx` following the established pattern.
3. Consume it from the component file via import.

---

## Responsive Requirements

### Mobile-First

Author base styles for the smallest breakpoint (375px), then enhance for larger viewports using Tailwind responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`).

```tsx
// Mobile-first: base is single column, md adds two columns
<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
```

### Breakpoints

Test every component at four breakpoints. The design must be intentional at each — not fluid-scaled from desktop.

| Breakpoint | Width | Tailwind Prefix | Focus |
|---|---|---|---|
| Mobile | 375px | (base) | Touch targets, thumb-reachable nav, stacked layouts |
| Tablet | 768px | `md:` | Two-column where appropriate, readable code blocks |
| Laptop | 1024px | `lg:` | Full layout, hover interactions |
| Desktop | 1440px | `xl:` | Maximum content width (`max-w-7xl`), generous whitespace |

### Touch Targets

All interactive elements must have a minimum touch target of 44 x 44 pixels on mobile viewports:

```tsx
// Button already meets this via size variants (h-10 = 40px, h-11 = 44px)
// For custom interactive elements:
<button className="min-h-11 min-w-11 ...">
```

Adjacent touch targets must have adequate spacing to prevent mis-taps.

### Code Blocks

Code blocks must be horizontally scrollable on narrow viewports. Never truncate code.

```tsx
<pre className="overflow-x-auto">
  <code>{/* ... */}</code>
</pre>
```

### Images

- Use Next.js `Image` component or `srcSet` for responsive sizing.
- No fixed-width images. Use relative widths or Tailwind responsive classes.
- Lazy-load below-fold images with `loading="lazy"`.
- SVG for icons and diagrams. WebP/AVIF for raster images.

### Content Max-Width

Content is constrained to `max-w-7xl` (80rem / 1280px) centered with `mx-auto`. Text blocks use `max-w-2xl` (42rem) for readability.

```tsx
<section className="py-24">
  <div className="mx-auto max-w-7xl px-6">
    <div className="max-w-2xl">
      <h2>Section heading</h2>
      <p>Body text constrained for readability.</p>
    </div>
    {/* Full-width grid within max-w-7xl */}
    <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
      {/* ... */}
    </div>
  </div>
</section>
```

---

## Accessibility Requirements

Accessibility is a design constraint, not an afterthought. Every component must meet WCAG 2.1 AA.

### Semantic HTML

Use the correct HTML element for the job. Semantic elements provide accessibility for free.

| Instead of | Use |
|---|---|
| `<div onClick>` | `<button>` |
| `<div>` (for section) | `<section aria-labelledby>` |
| `<div>` (for nav) | `<nav aria-label>` |
| `<div>` (for list) | `<ul>` / `<ol>` |
| `<span>` (for link) | `<a href>` |
| `<div role="heading">` | `<h2>`, `<h3>`, etc. |

### Heading Hierarchy

- One `<h1>` per page, defined in the page component.
- Sections use `<h2>`. Subsections use `<h3>`.
- Never skip heading levels (`<h3>` must follow `<h2>`, not `<h1>`).
- Headings must be nested correctly within their sections.

### ARIA Attributes

Use ARIA only when semantic HTML is insufficient.

| Pattern | ARIA | When |
|---|---|---|
| Section with heading | `aria-labelledby="{id}"` | Every organism (matches existing: `features-heading`, `hero-heading`) |
| Toggle button | `aria-expanded="{boolean}"` | Mobile menu trigger, accordion, dropdown |
| Dynamic content | `aria-live="polite"` | Content that updates without page navigation (copy confirmation, form errors) |
| Decorative elements | `aria-hidden="true"` | Icons paired with text, background visuals |
| Modal overlay | `role="dialog"`, `aria-modal="true"` | Mobile menu, any modal |

### Keyboard Navigation

- All interactive elements reachable via `Tab` / `Shift+Tab`.
- Focus order follows the visual reading order.
- `Enter` activates buttons and links. `Escape` closes modals and drawers.
- Focus indicators must be visible. Use the existing `:focus-visible` styles — do not remove outlines.
- Modal dialogs and drawers must trap focus and return it to the trigger on close.

### Contrast

| Context | Minimum Ratio |
|---|---|
| Body text | 4.5:1 |
| Large text (≥ 18px bold or ≥ 24px regular) | 3:1 |
| UI components and graphical objects | 3:1 |

Dark themes present unique contrast challenges. Test text on dark backgrounds specifically.

### Color Independence

Never use color as the sole channel for conveying information. Pair color with text labels, icons, or patterns.

### Images and Alt Text

- Meaningful images: descriptive `alt` text that conveys the image's purpose.
- Decorative images: empty `alt=""` so screen readers skip them.
- Icons paired with text: `aria-hidden="true"` on the icon.
- Icons without text: `aria-label` on the icon or its container.

### displayName

Every `forwardRef` component must set `displayName`. This surfaces the component name in React DevTools and error messages instead of "ForwardRef":

```tsx
Button.displayName = "Button";
```

---

## Quality Checklist

Before merging a new or modified component, verify every applicable item.

### Structure

- [ ] Component belongs to the correct taxonomy level (atom, molecule, organism, page)
- [ ] File is in the correct directory (`ui/`, `sections/`, `pages/`)
- [ ] File naming follows the convention (kebab-case for atoms/molecules, PascalCase for sections/pages)
- [ ] Component name is PascalCase
- [ ] Props type is `{ComponentName}Props`
- [ ] `className` and `id` are accepted
- [ ] HTML attributes are spread via `...props`
- [ ] `forwardRef` is used where applicable
- [ ] `displayName` is set on all `forwardRef` components

### Styling

- [ ] Tailwind utilities only — no arbitrary values
- [ ] Colors use design tokens from `globals.css` — no hardcoded values
- [ ] Variants use `cva` with a `variants` record
- [ ] Classes merged via `cn()` — no manual concatenation
- [ ] No inline `style` attribute (exception: runtime-computed values)

### Animation

- [ ] Uses variants from `lib/animations.ts` — no inline variant definitions
- [ ] Uses transitions from `transitions` — no inline `duration` or `ease`
- [ ] Prefers wrapper components (`FadeInUp`, `StaggerContainer`) over raw `motion.div`
- [ ] GPU-composited properties only (`transform`, `opacity`)
- [ ] `prefers-reduced-motion` respected (automatic via wrapper components or manual `useReducedMotion()` check)

### Responsive

- [ ] Mobile-first (base styles for 375px, enhanced with responsive prefixes)
- [ ] Tested at 375px, 768px, 1024px, 1440px
- [ ] Touch targets ≥ 44px on mobile
- [ ] Code blocks horizontally scrollable
- [ ] No fixed-width images

### Accessibility

- [ ] Semantic HTML elements used (not `<div>` for everything)
- [ ] Heading hierarchy correct (one `<h1>` per page, sequential levels, no skips)
- [ ] `aria-labelledby` on sections
- [ ] Keyboard navigable (Tab, Enter, Escape)
- [ ] Focus indicators visible (`:focus-visible`)
- [ ] Contrast ratios meet minimums (4.5:1 body, 3:1 large/UI)
- [ ] `alt` text on meaningful images, `alt=""` on decorative
- [ ] `aria-hidden="true"` on decorative icons

---

## Current Component Audit

This appendix catalogs inconsistencies found in the existing codebase as of 2026-03-21. These are informational — existing components are not required to be retroactively compliant. They should be addressed when the component is next modified.

### Inventory

```
site/src/components/
├── ui/           # 9 files (Button, Card, Badge, Icon, Logo, StigmerLogo, CodeBlock, SkipLink, motion)
├── layout/       # 3 files (Header, Footer, MobileMenu)
├── sections/     # 4 files (Hero, Features, Architecture, Quickstart)
├── pages/        # 1 file  (HomePage)
└── mdx/          # 2 files (LanguageIcons, Mermaid)
```

### Inconsistencies

| # | Issue | Affected Components | Standard Violated |
|---|---|---|---|
| 1 | `className` not accepted | `MobileMenu`, `LanguageIcons`, `Mermaid` | Required Props: all components must accept `className` |
| 2 | `id` not accepted | `CodeBlock`, `SkipLink`, `LanguageIcons`, `Mermaid` | Required Props: all components must accept `id` |
| 3 | Hardcoded Tailwind color names | `Badge` (`green-500`, `yellow-500`, `cyan-500`, `violet-500`, `emerald-500`) | Styling: all colors via CSS custom properties |
| 4 | Hardcoded rgba values | `Hero` (`rgba(59,130,246,...)`, `rgba(139,92,246,...)`) | Styling: all colors via CSS custom properties |
| 5 | Arbitrary value | `CodeBlock` (`text-[11px]` for size `sm`) | Styling: Tailwind utilities only, no arbitrary values |
| 6 | Duplicate logo concepts | `Logo`, `StigmerLogo`, raw `<img src="/logo.svg">` in Header/Footer | Naming: one canonical component per concept |
| 7 | Inline animation durations | `Architecture` (`duration: 0.3`, `duration: 0.5`, `duration: 0.8`) | Animation: use `transitions` presets, no inline values |
| 8 | Inline animation in MobileMenu footer | `MobileMenu` (inline `animate` props) | Animation: use wrapper components or imported variants |
| 9 | Missing `forwardRef` | `Badge`, `Icon` | Required Props: components rendering a single DOM element should use `forwardRef` |
| 10 | Missing `displayName` | `Badge`, `Icon` | Required Props: every `forwardRef` component must set `displayName` |
| 11 | MDX components skip site patterns | `LanguageIcons` (inline styles, no `cn()`), `Mermaid` (no Tailwind) | Styling: use Tailwind and `cn()` |
| 12 | Non-standard font size | `CodeBlock` size `sm` uses `text-[11px]` instead of `text-xs` (12px) | Styling: use Tailwind scale values |
