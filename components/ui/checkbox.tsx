import * as React from "react";
import { cn } from "@/lib/utils";

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          "h-4 w-4 rounded border border-slate-300 accent-slate-900 dark:border-slate-700 dark:accent-slate-200",
          className
        )}
        {...props}
      />
    );
  }
);
Checkbox.displayName = "Checkbox";
