import * as React from "react";
import { Slider as BaseSlider } from "@base-ui-components/react/slider";
import { cn } from "@/lib/utils";

export const Slider = React.forwardRef<
  React.ComponentRef<typeof BaseSlider.Root>,
  React.ComponentProps<typeof BaseSlider.Root>
>(({ className, ...props }, ref) => (
  <BaseSlider.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none items-center select-none",
      className,
    )}
    {...props}
  >
    <BaseSlider.Control className="flex w-full items-center">
      <BaseSlider.Track className="relative h-1 w-full rounded-full bg-muted">
        <BaseSlider.Indicator className="absolute rounded-full bg-primary" />
        <BaseSlider.Thumb className="h-3.5 w-3.5 rounded-full bg-primary outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </BaseSlider.Track>
    </BaseSlider.Control>
  </BaseSlider.Root>
));
Slider.displayName = "Slider";
