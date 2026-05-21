import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Plain native input, grey-token styled. Kept as a native element (not Base
 * UI's Field-coupled Input) so the standard onChange contract used across the
 * panel works without wiring a Field provider.
 */
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
