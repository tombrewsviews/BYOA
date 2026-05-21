# ReUI + Tailwind v4 + grey + icons (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up Tailwind v4 + a neutral-grey shadcn token system + ReUI (Base UI flavor) components + lucide icons in the editor, and migrate the properties-panel controls to ReUI without changing any consumer code.

**Architecture:** Add Tailwind v4 via its Vite plugin to the editor build, define the grey palette once as CSS variables (consumed by ReUI/Tailwind) and mirror the same hex into `theme.ts` (consumed by the still-inline-styled rest of the app). Rewrite `editor/controls.tsx` to wrap ReUI/Base UI components while preserving its exact public API, so `panel.tsx` is untouched.

**Tech Stack:** Tailwind CSS v4.3, `@tailwindcss/vite`, `@base-ui-components/react` 1.0.0-rc, ReUI (copy-paste, Base UI style), lucide-react, class-variance-authority, clsx, tailwind-merge, tw-animate-css. React 19, Vite, Tauri/Chromium.

---

## Verified facts (from pre-plan research)

- Package versions exist: tailwindcss 4.3.0, @tailwindcss/vite 4.3.0,
  @base-ui-components/react 1.0.0-rc.0, lucide-react 1.16.0, cva 0.7.1,
  clsx 2.1.1, tailwind-merge 3.6.0, tw-animate-css 1.4.0, shadcn CLI 4.8.0.
- Base UI exposes subpath exports (`./menu`, `./tabs`, `./form`, …) — so
  `@base-ui-components/react/select` etc. are the import paths.
- ReUI registry styles are named `{primitive}-nova` (observed `radix-nova`);
  Base UI flavor is `base-nova`. The registry serves through the shadcn CLI;
  hand-curling guessed `.json` URLs returns 404. **Therefore the CLI is the
  primary path; if it can't resolve ReUI's Base UI components, Task 4 authors
  the 4 needed components by hand against Base UI + our Tailwind tokens
  (matching ReUI structure).** Either path yields owned source in
  `editor/components/ui/`.

## File structure

- Create: `editor/index.css` — Tailwind entry + grey CSS-variable tokens.
- Create: `editor/lib/utils.ts` — `cn()` helper.
- Create: `editor/icons.ts` — curated lucide re-exports.
- Create: `editor/components/ui/select.tsx`, `slider.tsx`, `input.tsx`,
  `switch.tsx` — owned ReUI/Base UI components.
- Create: `components.json` (repo root) — shadcn/ReUI registry config.
- Modify: `vite.editor.config.ts` — add `@tailwindcss/vite` plugin.
- Modify: `editor/main.tsx` — import `./index.css`.
- Modify: `editor/platform/theme.ts` — grey hex values.
- Modify: `editor/controls.tsx` — wrap ReUI components, same public API.
- Modify: `tsconfig.json` — path alias `@/*` → `editor/*` (shadcn convention).
- Modify: `editor/panel.tsx` — swap the "animate" checkbox to ReUI Switch and
  panel-region emoji to lucide (small, surgical).

---

## Task 1: Tailwind v4 foundation

**Files:** `vite.editor.config.ts`, `editor/index.css`, `editor/main.tsx`, `tsconfig.json`, `editor/lib/utils.ts`

- [ ] **Step 1: Install deps**

```bash
npm install -D tailwindcss@4 @tailwindcss/vite@4 tw-animate-css
npm install @base-ui-components/react lucide-react class-variance-authority clsx tailwind-merge
```

- [ ] **Step 2: Add the Tailwind Vite plugin**

In `vite.editor.config.ts`, import and add the plugin:

```ts
import tailwindcss from "@tailwindcss/vite";
```

and in the `plugins` array add `tailwindcss()` before `react()`:

```ts
  plugins: [tailwindcss(), react(), storyJsonPlugin()],
```

- [ ] **Step 3: Create the Tailwind entry + grey tokens**

Create `editor/index.css`:

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

/* Grey scheme. Dark is the default the app runs in; light kept for completeness.
   These shadcn-style variables are the source of truth for ReUI/Tailwind
   components. editor/platform/theme.ts mirrors the same hex for the inline-
   styled (not-yet-migrated) parts of the app. */
:root {
  --radius: 0.5rem;
  --background: #f5f5f5;
  --foreground: #0a0a0a;
  --card: #ffffff;
  --card-foreground: #0a0a0a;
  --popover: #ffffff;
  --popover-foreground: #0a0a0a;
  --primary: #18181b;
  --primary-foreground: #fafafa;
  --secondary: #e7e7e9;
  --secondary-foreground: #18181b;
  --muted: #e7e7e9;
  --muted-foreground: #6e6e72;
  --accent: #e7e7e9;
  --accent-foreground: #18181b;
  --destructive: #dc2626;
  --destructive-foreground: #fafafa;
  --border: #d4d4d8;
  --input: #d4d4d8;
  --ring: rgba(10,10,10,0.22);
}

.dark, :root {
  /* App is dark-by-default: apply the dark grey scheme at :root too so no
     class toggle is required. */
  --background: #0a0a0a;
  --foreground: #fafafa;
  --card: #121212;
  --card-foreground: #fafafa;
  --popover: #18181a;
  --popover-foreground: #fafafa;
  --primary: #fafafa;
  --primary-foreground: #0a0a0a;
  --secondary: #242427;
  --secondary-foreground: #fafafa;
  --muted: #1e1e20;
  --muted-foreground: #9a9a9d;
  --accent: #242427;
  --accent-foreground: #fafafa;
  --destructive: #f87171;
  --destructive-foreground: #0a0a0a;
  --border: #2a2a2c;
  --input: #2a2a2c;
  --ring: rgba(250,250,250,0.22);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
}
```

- [ ] **Step 4: Import the CSS in the editor entry**

In `editor/main.tsx`, add as the FIRST import line:

```ts
import "./index.css";
```

- [ ] **Step 5: Add the `@/*` path alias**

In `tsconfig.json`, add under `compilerOptions`:

```json
    "baseUrl": ".",
    "paths": { "@/*": ["editor/*"] }
```

And in `vite.editor.config.ts` `resolve.alias`, replace the empty `alias: {}` with:

```ts
    alias: { "@": path.join(PROJECT_ROOT, "editor") },
```

- [ ] **Step 6: Add the `cn()` helper**

Create `editor/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 7: Verify the build compiles with Tailwind**

Run: `npm run build:editor`
Expected: build succeeds and emits CSS into `editor/dist/assets`. If it fails,
read the Tailwind/Vite error before proceeding (do not continue on a broken
foundation).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.editor.config.ts editor/index.css editor/main.tsx tsconfig.json editor/lib/utils.ts
git commit -m "feat(studio): Tailwind v4 foundation + grey shadcn token system"
```

---

## Task 2: Mirror the grey scheme into theme.ts

So the not-yet-migrated inline-styled app matches the new grey CSS variables.

**Files:** `editor/platform/theme.ts`

- [ ] **Step 1: Update the color hex values**

In `editor/platform/theme.ts`, replace the `color` object's values with the
grey scheme (keep keys + structure identical so all consumers keep working):

```ts
export const color = {
  bg: {
    canvas: "#0a0a0a",
    surface: "#121212",
    raised: "#18181a",
    hover: "#1e1e20",
    selected: "#242427",
  },
  border: {
    faint: "#1e1e20",
    line: "#2a2a2c",
    strong: "#3a3a3d",
    hover: "#4a4a4d",
  },
  text: {
    primary: "#fafafa",
    secondary: "#e6e6e8",
    muted: "#9a9a9d",
    dim: "#6e6e72",
    faint: "#5a5a5d",
  },
  accent: {
    fg: "#fafafa",
    bg: "#0a0a0a",
    dot: "#fafafa",
    focus: "rgba(250,250,250,0.22)",
  },
  danger: {
    bg: "#2a1414",
    border: "#5a2424",
    text: "#fca5a5",
  },
} as const;
```

- [ ] **Step 2: Update the body bg in index.html to match**

In `editor/index.html`, change `body { background: #08080c; }` to
`body { background: #0a0a0a; }`.

- [ ] **Step 3: Verify build + typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Run: `npm run build:editor`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add editor/platform/theme.ts editor/index.html
git commit -m "feat(studio): grey scheme — mirror neutral tokens into theme.ts"
```

---

## Task 3: ReUI registry config + Base UI components (CLI path)

**Files:** `components.json`, `editor/components/ui/*.tsx`

- [ ] **Step 1: Create components.json**

Create `components.json` at the repo root:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "editor/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib"
  },
  "registries": {
    "@reui": "https://reui.io/r/styles/base-nova/{name}.json"
  }
}
```

- [ ] **Step 2: Try pulling ReUI Base UI components via the CLI**

Run (one at a time, so a failure is isolated):

```bash
npx shadcn@latest add @reui/select
npx shadcn@latest add @reui/slider
npx shadcn@latest add @reui/input
npx shadcn@latest add @reui/switch
```

Expected: each writes a file into `editor/components/ui/`. If the CLI errors
("registry not found" / 404 / "base-nova" wrong), STOP this task and use
**Task 4** (hand-authored components) instead, then skip to Task 5. Record
which path was used.

- [ ] **Step 3: If CLI succeeded, verify the components import Base UI**

Run: `grep -l "@base-ui-components/react" editor/components/ui/*.tsx`
Expected: select/slider/switch reference Base UI. If they reference
`@radix-ui/*` instead, the wrong style was pulled — remove them and use Task 4.

- [ ] **Step 4: Build with the pulled components**

Run: `npm run build:editor`
Expected: succeeds. If a peer dep is missing, install it and re-run.

- [ ] **Step 5: Commit (only if CLI path used)**

```bash
git add components.json editor/components/ui editor/lib package.json package-lock.json
git commit -m "feat(studio): add ReUI (Base UI) Select/Slider/Input/Switch via registry"
```

---

## Task 4: Hand-authored Base UI components (fallback — only if Task 3 CLI failed)

Author the four components directly against Base UI + our grey Tailwind tokens.
Skip entirely if Task 3 succeeded.

**Files:** `editor/components/ui/select.tsx`, `slider.tsx`, `input.tsx`, `switch.tsx`, `components.json`

- [ ] **Step 1: Create components.json** (same as Task 3 Step 1, minus the
  `registries` block since we're not using the registry):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": { "config": "", "css": "editor/index.css", "baseColor": "neutral", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib" }
}
```

- [ ] **Step 2: Input**

Create `editor/components/ui/input.tsx`:

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>(({ className, type, ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "flex h-8 w-full rounded-md border border-input bg-card px-2.5 py-1 text-xs text-foreground",
      "outline-none transition-colors placeholder:text-muted-foreground",
      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
```

- [ ] **Step 3: Switch (Base UI)**

Create `editor/components/ui/switch.tsx`:

```tsx
import * as React from "react";
import { Switch as BaseSwitch } from "@base-ui-components/react/switch";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ComponentRef<typeof BaseSwitch.Root>,
  React.ComponentProps<typeof BaseSwitch.Root>
>(({ className, ...props }, ref) => (
  <BaseSwitch.Root
    ref={ref}
    className={cn(
      "relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full",
      "border border-border bg-muted transition-colors outline-none",
      "focus-visible:ring-2 focus-visible:ring-ring",
      "data-[checked]:bg-primary",
      className,
    )}
    {...props}
  >
    <BaseSwitch.Thumb
      className={cn(
        "block h-3 w-3 translate-x-0.5 rounded-full bg-foreground transition-transform",
        "data-[checked]:translate-x-3.5 data-[checked]:bg-primary-foreground",
      )}
    />
  </BaseSwitch.Root>
));
Switch.displayName = "Switch";
```

- [ ] **Step 4: Slider (Base UI)**

Create `editor/components/ui/slider.tsx`:

```tsx
import * as React from "react";
import { Slider as BaseSlider } from "@base-ui-components/react/slider";
import { cn } from "@/lib/utils";

export const Slider = React.forwardRef<
  React.ComponentRef<typeof BaseSlider.Root>,
  React.ComponentProps<typeof BaseSlider.Root>
>(({ className, ...props }, ref) => (
  <BaseSlider.Root
    ref={ref}
    className={cn("relative flex w-full touch-none items-center select-none", className)}
    {...props}
  >
    <BaseSlider.Control className="flex w-full items-center">
      <BaseSlider.Track className="h-1 w-full rounded-full bg-muted">
        <BaseSlider.Indicator className="rounded-full bg-primary" />
        <BaseSlider.Thumb className="h-3.5 w-3.5 rounded-full bg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </BaseSlider.Track>
    </BaseSlider.Control>
  </BaseSlider.Root>
));
Slider.displayName = "Slider";
```

- [ ] **Step 5: Select (Base UI)**

Create `editor/components/ui/select.tsx`:

```tsx
import * as React from "react";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = BaseSelect.Root;

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof BaseSelect.Trigger>,
  React.ComponentProps<typeof BaseSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Trigger
    ref={ref}
    className={cn(
      "flex h-8 w-full items-center justify-between rounded-md border border-input bg-card px-2.5 text-xs text-foreground",
      "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring",
      "data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
  </BaseSelect.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectValue = BaseSelect.Value;

export const SelectContent: React.FC<
  React.ComponentProps<typeof BaseSelect.Popup>
> = ({ className, children, ...props }) => (
  <BaseSelect.Portal>
    <BaseSelect.Positioner sideOffset={4} className="z-50">
      <BaseSelect.Popup
        className={cn(
          "max-h-72 min-w-[8rem] overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </BaseSelect.Popup>
    </BaseSelect.Positioner>
  </BaseSelect.Portal>
);

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof BaseSelect.Item>,
  React.ComponentProps<typeof BaseSelect.Item>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Item
    ref={ref}
    className={cn(
      "relative flex cursor-pointer items-center rounded-sm py-1.5 pr-2 pl-7 text-xs outline-none",
      "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <BaseSelect.ItemIndicator>
        <Check className="h-3.5 w-3.5" />
      </BaseSelect.ItemIndicator>
    </span>
    <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
  </BaseSelect.Item>
));
SelectItem.displayName = "SelectItem";
```

- [ ] **Step 6: Build**

Run: `npm run build:editor`
Expected: succeeds. If a Base UI subpath import path is wrong, check the
package's exports (`npm view @base-ui-components/react exports`) and fix the
import (the subpath is the lowercased component name).

- [ ] **Step 7: Commit**

```bash
git add components.json editor/components/ui editor/lib package.json package-lock.json
git commit -m "feat(studio): Base UI Select/Slider/Input/Switch (ReUI-style, hand-authored)"
```

---

## Task 5: Icons module

**Files:** `editor/icons.ts`

- [ ] **Step 1: Create the curated icon re-exports**

Create `editor/icons.ts`:

```ts
/**
 * Single source for app icons (lucide-react). Import from here, not directly
 * from lucide, so swapping the icon set later is a one-file change. Add icons
 * as the UI needs them.
 */
export {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Check,
  X,
  ArrowLeft,
  ArrowRight,
  Play,
  Pause,
  Download,
  Loader2,
  Folder,
  Undo2,
  Redo2,
  Plus,
} from "lucide-react";
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add editor/icons.ts
git commit -m "feat(studio): lucide icon module (single source for app icons)"
```

---

## Task 6: Rewrite controls.tsx to wrap ReUI — same public API

The critical isolation step: `panel.tsx` imports `Row, Slider, Dropdown,
ColorControl, TextInput, EasingPicker` from `controls.tsx`. Keep ALL of those
exports with the SAME prop signatures; only the internals change.

**Files:** `editor/controls.tsx`

- [ ] **Step 1: Rewrite the file**

Replace `editor/controls.tsx` with ReUI-backed implementations that keep the
identical exported API. Full file:

```tsx
/**
 * Reusable properties-panel controls — now backed by ReUI (Base UI) components
 * + Tailwind grey tokens. The PUBLIC API is unchanged (Row, Slider, Dropdown,
 * ColorControl, TextInput, EasingPicker) so panel.tsx and every other consumer
 * is unaffected; only the rendering swapped from inline styles to ReUI.
 */
import React from "react";
import { resolveEasing, type EasingName } from "../src/typography/easings";
import { color } from "./platform/theme";
import { Slider as UISlider } from "./components/ui/slider";
import { Input as UIInput } from "./components/ui/input";
import {
  Select as UISelect,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./components/ui/select";

// --- Row scaffold (layout only) --------------------------------------------
export const Row: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="flex items-center gap-2.5 min-h-[30px]">
    <span className="w-[78px] shrink-0 text-[11px] lowercase text-muted-foreground">
      {label}
    </span>
    <div className="flex flex-1 items-center">{children}</div>
  </div>
);

// --- TextInput --------------------------------------------------------------
export const TextInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}> = ({ value, onChange, placeholder }) => (
  <UIInput
    type="text"
    value={value}
    placeholder={placeholder}
    onChange={(e) => onChange(e.target.value)}
  />
);

// --- Slider (range + numeric readout) --------------------------------------
export const Slider: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}> = ({ value, min, max, step, onChange }) => (
  <div className="flex flex-1 items-center gap-2">
    <UISlider
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : (v as number))}
    />
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-[52px] rounded-md border border-input bg-secondary px-1.5 py-1 text-right text-[11px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
  </div>
);

// --- Dropdown (ReUI Select, same string-in/string-out API) -----------------
export const Dropdown: React.FC<{
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}> = ({ value, options, onChange }) => (
  <UISelect value={value} onValueChange={(v) => onChange(v as string)}>
    <SelectTrigger>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {options.map((o) => (
        <SelectItem key={o} value={o}>
          {o}
        </SelectItem>
      ))}
    </SelectContent>
  </UISelect>
);

// --- ColorControl: native color swatch + ReUI hex Input --------------------
export const ColorControl: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => (
  <div className="flex flex-1 items-center gap-2">
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="pick color"
      className="h-[22px] w-[22px] cursor-pointer rounded border border-border bg-transparent p-0"
    />
    <UIInput
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      className="font-mono"
    />
  </div>
);

// --- EasingPicker: bespoke SVG curve thumbnails (kept; retoned to grey) -----
const CURVE_SIZE = 44;

const CurveThumb: React.FC<{
  easing: EasingName;
  selected: boolean;
  onSelect: () => void;
}> = ({ easing, selected, onSelect }) => {
  const fn = resolveEasing(easing);
  const pts: string[] = [];
  const N = 24;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const y = fn(t);
    pts.push(`${(t * CURVE_SIZE).toFixed(1)},${((1 - y) * CURVE_SIZE).toFixed(1)}`);
  }
  return (
    <button
      onClick={onSelect}
      title={easing}
      className={
        "flex flex-col items-center gap-0.5 rounded-md border p-1 cursor-pointer " +
        (selected
          ? "border-ring bg-accent"
          : "border-border bg-secondary")
      }
    >
      <svg width={CURVE_SIZE} height={CURVE_SIZE}>
        <line
          x1={0}
          y1={CURVE_SIZE}
          x2={CURVE_SIZE}
          y2={0}
          stroke={color.border.strong}
          strokeWidth={1}
        />
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke={selected ? color.text.primary : color.text.dim}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={selected ? "text-[9px] text-foreground" : "text-[9px] text-muted-foreground"}>
        {easing.replace("power", "p")}
      </span>
    </button>
  );
};

export const EasingPicker: React.FC<{
  value: EasingName;
  onChange: (v: EasingName) => void;
}> = ({ value, onChange }) => {
  const options: EasingName[] = ["power3.out", "power3.inOut", "power4.out", "spring"];
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((e) => (
        <CurveThumb
          key={e}
          easing={e}
          selected={value === e}
          onSelect={() => onChange(e)}
        />
      ))}
    </div>
  );
};
```

NOTE on Base UI Slider `onValueChange`: Base UI's Slider emits the value as a
number (single thumb) or array; the wrapper normalizes both. If the installed
Base UI version names the prop differently, check
`editor/components/ui/slider.tsx`'s Root props and align the wrapper.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. Fix any prop-name mismatches against the actual Base UI
Slider/Select API surfaced by the compiler.

- [ ] **Step 3: Existing logic tests still pass**

Run: `npm run test`
Expected: 50 passing (typography-axes + agent-chat). controls.tsx has no tests;
panel logic is untouched.

- [ ] **Step 4: Build**

Run: `npm run build:editor`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add editor/controls.tsx
git commit -m "feat(studio): properties-panel controls now use ReUI (Base UI), grey-styled"
```

---

## Task 7: Panel Switch + panel-region icons

The panel's "animate" axis toggle is a raw checkbox; swap to ReUI Switch.
Replace panel-region emoji with lucide.

**Files:** `editor/panel.tsx`

- [ ] **Step 1: Swap the animate checkbox to Switch**

In `editor/panel.tsx`, import the Switch:

```ts
import { Switch } from "./components/ui/switch";
```

In `AxisControl`, replace the `<input type="checkbox" checked={animated} … />`
with:

```tsx
            <Switch
              checked={animated}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? setAxisRange(axes, axis, start, clampAxis(max, axis, family), family)
                    : setAxisStatic(axes, axis, start, family),
                )
              }
            />
```

(Base UI Switch uses `onCheckedChange`; if the installed version uses a
different callback name, the compiler will flag it — align to the actual prop.)

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json`
Run: `npm run build:editor`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add editor/panel.tsx
git commit -m "feat(studio): panel axis 'animate' uses ReUI Switch"
```

---

## Task 8: Manual verification + final checks

- [ ] **Step 1: Full automated verification**

Run: `npx tsc --noEmit -p tsconfig.json` → clean
Run: `npm run test` → 50 passing
Run: `npm run build:editor` → succeeds

- [ ] **Step 2: Manual smoke in the app**

Run: `npm run tauri:dev`. Verify:
- App-wide grey scheme (no blue/purple tint in chrome).
- Properties panel: Select dropdowns open and pick (font, kind, blend, etc.),
  sliders drag and update, hex input edits color, easing thumbs select,
  the typography "animate" toggle is a Switch and works, all params still edit
  the story (font switch changes preview, axes change preview).
- No emoji left in the panel region; icons render.
- Open a beat, change font/weight/width/slant → preview updates (regression
  check on the earlier font fix).

- [ ] **Step 3: Render regression check**

Run a still render to confirm the composition is unaffected:

```bash
node_modules/.bin/remotion still KineticStory /tmp/reui-check.png --frame=30
```

Expected: renders a PNG (composition untouched by this UI work).

- [ ] **Step 4: Push**

```bash
git push
```

---

## Notes on risk

- **Base UI API drift:** `@base-ui-components/react` is at 1.0.0-rc; exact
  subcomponent prop names (`onValueChange`, `onCheckedChange`, Slider parts)
  may differ slightly from the snippets. The TYPES are the authority — let
  `tsc` guide exact prop names and fix against the compiler. The wrapper
  pattern (Tasks 4/6) localizes any such fix to `editor/components/ui/*`.
- **CLI vs hand-authored:** Task 3 (CLI) is preferred; Task 4 is the verified
  fallback using Base UI primitives we confirmed exist. Exactly one of them
  runs.
- **Two token sources** (`index.css` vars + `theme.ts` hex) is intentional for
  the migration window; later phases collapse it.
