import * as React from "react";
import { Select as BaseSelect } from "@base-ui-components/react/select";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = BaseSelect.Root;
export const SelectValue = BaseSelect.Value;

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof BaseSelect.Trigger>,
  React.ComponentProps<typeof BaseSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <BaseSelect.Trigger
    ref={ref}
    className={cn(
      "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 text-xs text-foreground",
      "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-ring",
      "data-[disabled]:opacity-50",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  </BaseSelect.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

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
