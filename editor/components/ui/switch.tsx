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
