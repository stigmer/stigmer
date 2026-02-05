---
name: Stigmer Website Theme Enhancement
overview: Transform the Stigmer.ai website from a static, muted design to a vibrant, animated experience matching the donepudi.me aesthetic while maintaining production-grade code quality, performance, and accessibility standards.
todos:
  - id: foundation-deps
    content: Install framer-motion and create animation design system (animations.ts)
    status: pending
  - id: css-tokens
    content: Extend globals.css with glow, glass, and animation tokens
    status: pending
  - id: motion-components
    content: Create reusable motion wrapper components (FadeInUp, StaggerContainer, StaggerItem)
    status: pending
  - id: card-glass
    content: Add glass variant to Card component with proper hover effects
    status: pending
  - id: hero-animation
    content: Enhance Hero section with entrance animations and improved effects
    status: pending
  - id: features-stagger
    content: Add staggered entrance animations to Features grid
    status: pending
  - id: architecture-scroll
    content: Add scroll-triggered animations to Architecture section
    status: pending
  - id: quickstart-animation
    content: Add step animations and progress indicators to Quickstart
    status: pending
  - id: header-nav
    content: Add animated underlines to nav links and AnimatePresence to mobile menu
    status: pending
  - id: accessibility
    content: Implement reduced-motion support and verify accessibility
    status: pending
  - id: quality-validation
    content: "Run all quality gates: typecheck, lint, build, Lighthouse audit"
    status: pending
isProject: false
---

# Stigmer.ai Theme Enhancement - Production-Grade Implementation

## Objective

Bring the visual richness and interactivity of donepudi.me to stigmer.ai with world-class engineering standards: type-safe animations, performance-optimized effects, accessible interactions, and maintainable architecture.

---

## Current State Analysis

### Stigmer.ai (Current)
- **Theme**: Muted dark with blue (#3b82f6) / purple (#8b5cf6)
- **Animations**: None (static)
- **Effects**: Minimal glassmorphism, subtle shadows
- **Code Quality**: TypeScript, well-structured components
- **Location**: [site/src/](site/src/)

### donepudi.me (Target Aesthetic)
- **Theme**: Vibrant dark with cyan (cyan-400/500) accents
- **Animations**: Framer Motion throughout (entrance, scroll, hover)
- **Effects**: Heavy glassmorphism, gradient borders, glow shadows, floating particles
- **Interactivity**: Terminal typing, progress bars, animated underlines

---

## Architecture Decisions

### Animation Library Choice: Framer Motion

Framer Motion is the correct choice for this platform because:
- **Type-safe**: Full TypeScript support with proper generics
- **Performance**: Hardware-accelerated, automatic GPU offloading
- **SSR Compatible**: Works with Next.js App Router
- **Declarative**: Matches React component model
- **Feature-rich**: Gestures, layout animations, AnimatePresence

### Design Token Strategy

We will NOT replace the existing color system. Instead, we will:
1. **Extend** the current tokens with glow/glass variants
2. **Add** animation tokens as CSS custom properties
3. **Preserve** backward compatibility

---

## Implementation Plan

### Phase 1: Foundation Layer

#### 1.1 Install Dependencies

```bash
# In site/ directory
yarn add framer-motion
```

#### 1.2 Create Animation Design System

Create a centralized animation configuration at [site/src/lib/animations.ts](site/src/lib/animations.ts):

```typescript
// Type-safe animation variants
export const fadeInUp = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
} as const;

export const staggerContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2
    }
  }
} as const;

// Animation presets with consistent timing
export const transitions = {
  spring: { type: "spring", stiffness: 300, damping: 30 },
  smooth: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] },
  fast: { duration: 0.2, ease: "easeOut" }
} as const;
```

#### 1.3 Extend CSS Design Tokens

Update [site/src/app/globals.css](site/src/app/globals.css) to add:

```css
:root {
  /* Existing tokens preserved... */
  
  /* Glow effects */
  --glow-primary: 0 0 20px hsl(var(--primary) / 0.3);
  --glow-accent: 0 0 20px hsl(var(--accent) / 0.3);
  
  /* Glassmorphism */
  --glass-bg: hsl(var(--background) / 0.8);
  --glass-border: hsl(var(--primary) / 0.2);
  
  /* Animation durations (for CSS animations) */
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 500ms;
}
```

---

### Phase 2: Reusable Animation Components

#### 2.1 Create Motion Wrapper Components

Create [site/src/components/ui/motion.tsx](site/src/components/ui/motion.tsx):

```typescript
"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { forwardRef, type ElementType } from "react";
import { fadeInUp, staggerContainer, transitions } from "@/lib/animations";

// FadeInUp - for individual elements
export const FadeInUp = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  ({ children, ...props }, ref) => (
    <motion.div
      ref={ref}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-100px" }}
      variants={fadeInUp}
      transition={transitions.smooth}
      {...props}
    >
      {children}
    </motion.div>
  )
);
FadeInUp.displayName = "FadeInUp";

// StaggerContainer - for grid/list parents
export const StaggerContainer = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  ({ children, ...props }, ref) => (
    <motion.div
      ref={ref}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true }}
      variants={staggerContainer}
      {...props}
    >
      {children}
    </motion.div>
  )
);
StaggerContainer.displayName = "StaggerContainer";

// StaggerItem - for children of StaggerContainer
export const StaggerItem = forwardRef<HTMLDivElement, HTMLMotionProps<"div">>(
  ({ children, ...props }, ref) => (
    <motion.div
      ref={ref}
      variants={fadeInUp}
      transition={transitions.smooth}
      {...props}
    >
      {children}
    </motion.div>
  )
);
StaggerItem.displayName = "StaggerItem";
```

#### 2.2 Create AnimatePresence Wrapper for Modals/Menus

Update mobile menu to use AnimatePresence for proper exit animations.

---

### Phase 3: Card Enhancement

#### 3.1 Update Card Component

Modify [site/src/components/ui/card.tsx](site/src/components/ui/card.tsx) to add glassmorphism variant:

```typescript
const cardVariants = cva(
  "rounded-lg transition-all duration-300",
  {
    variants: {
      variant: {
        default: "bg-card border border-border",
        feature: "bg-card border border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/10",
        glass: [
          "bg-card/80 backdrop-blur-sm",
          "border border-primary/20",
          "hover:border-primary/40",
          "hover:shadow-[var(--glow-primary)]",
          "transition-all duration-300"
        ].join(" ")
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
```

---

### Phase 4: Section-by-Section Enhancement

#### 4.1 Hero Section

File: [site/src/components/sections/Hero.tsx](site/src/components/sections/Hero.tsx)

Changes:
- Wrap content in `FadeInUp` components with staggered delays
- Add animated gradient background (already has static version)
- Enhance terminal command with typing cursor animation
- Add subtle floating particle effect (performance-conscious)

#### 4.2 Features Section

File: [site/src/components/sections/Features.tsx](site/src/components/sections/Features.tsx)

Changes:
- Wrap grid in `StaggerContainer`
- Wrap each card in `StaggerItem`
- Update cards to use `variant="glass"`
- Add icon hover scale transform

#### 4.3 Architecture Section

File: [site/src/components/sections/Architecture.tsx](site/src/components/sections/Architecture.tsx)

Changes:
- Add scroll-triggered animations for the three columns
- Animate arrows/flow indicators
- Stagger code examples appearance

#### 4.4 Quickstart Section

File: [site/src/components/sections/Quickstart.tsx](site/src/components/sections/Quickstart.tsx)

Changes:
- Stagger step cards entrance
- Add progress line animation between steps
- Enhance code block with syntax-aware styling

---

### Phase 5: Header/Navigation Enhancement

File: [site/src/components/layout/Header.tsx](site/src/components/layout/Header.tsx)

Changes:
- Add animated underline on nav link hover (pure CSS, no JS)
- Update mobile menu with AnimatePresence exit animations
- Add subtle logo entrance animation

CSS addition for animated underline:
```css
.nav-link::after {
  content: "";
  position: absolute;
  bottom: -2px;
  left: 0;
  width: 0;
  height: 2px;
  background: hsl(var(--primary));
  transition: width var(--duration-normal) ease;
}
.nav-link:hover::after {
  width: 100%;
}
```

---

### Phase 6: Performance Optimization

#### 6.1 Animation Performance

- Use `will-change` sparingly (only during animation)
- Prefer `transform` and `opacity` (compositor-only properties)
- Use `viewport={{ once: true }}` to prevent re-animation
- Implement reduced-motion media query support:

```typescript
import { useReducedMotion } from "framer-motion";

function Component() {
  const prefersReducedMotion = useReducedMotion();
  // Disable animations if user prefers reduced motion
}
```

#### 6.2 Bundle Impact

Framer Motion adds ~30KB gzipped. This is acceptable for the animation capability gained. We will:
- Use dynamic imports for heavy animation components if needed
- Tree-shake unused motion components

---

### Phase 7: Accessibility

All animations will respect:
- `prefers-reduced-motion` - disable animations for users who prefer less motion
- Keyboard focus states - enhanced focus rings
- Screen reader announcements - no animation-only content

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `site/package.json` | Modify | Add framer-motion dependency |
| `site/src/lib/animations.ts` | Create | Animation variants and transitions |
| `site/src/app/globals.css` | Modify | Add glow/glass tokens |
| `site/src/components/ui/motion.tsx` | Create | Reusable motion components |
| `site/src/components/ui/card.tsx` | Modify | Add glass variant |
| `site/src/components/sections/Hero.tsx` | Modify | Add entrance animations |
| `site/src/components/sections/Features.tsx` | Modify | Add stagger animations |
| `site/src/components/sections/Architecture.tsx` | Modify | Add scroll animations |
| `site/src/components/sections/Quickstart.tsx` | Modify | Add step animations |
| `site/src/components/layout/Header.tsx` | Modify | Add nav animations |
| `site/src/components/layout/MobileMenu.tsx` | Modify | Add AnimatePresence |

---

## Quality Gates

Before considering this work complete:

1. **Type Safety**: Zero TypeScript errors
2. **Lint**: Zero ESLint errors
3. **Build**: `npm run build` succeeds
4. **Performance**: Lighthouse performance score >= 90
5. **Accessibility**: Lighthouse accessibility score >= 95
6. **Bundle Size**: First Load JS increase <= 35KB
7. **Reduced Motion**: All animations respect user preference
8. **Visual QA**: Verified at 3 breakpoints (mobile, tablet, desktop)

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Bundle size bloat | Tree-shake, dynamic imports if needed |
| Animation jank | Use compositor-only properties, test on low-end devices |
| SSR hydration mismatch | Use "use client" directive, proper initial states |
| Accessibility regression | Test with screen readers, respect reduced-motion |

---

## Definition of Done

- All sections animate smoothly on scroll
- Cards have glassmorphism with glow on hover
- Navigation has animated underlines
- Mobile menu animates in/out
- All quality gates passed
- Changelog entry created
- `next-task.md` updated with completion status
