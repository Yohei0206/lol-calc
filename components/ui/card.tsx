import * as React from "react";
import { cn } from "@/lib/utils";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-slate-100 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/50",
        className
      )}
      {...props}
    />
  );
}
