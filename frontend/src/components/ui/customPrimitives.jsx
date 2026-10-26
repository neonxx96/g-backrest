import * as React from "react"
import { cn } from "@/lib/utils"

export function KpiCard({ title, value, subtext, delta, variant = "default", className }) {
  const deltaColor = delta > 0 ? "text-bull" : delta < 0 ? "text-bear" : "text-muted-foreground";

  return (
    <div className={cn("p-2 rounded-xs border border-border/60 bg-card/60 flex flex-col justify-between", className)}>
      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
        <span>{title}</span>
        {delta !== undefined && (
          <span className={cn("font-mono tabular-nums text-[11px]", deltaColor)}>
            {delta > 0 ? `+${delta}` : delta}%
          </span>
        )}
      </div>
      <div className="text-base font-semibold font-mono tabular-nums text-foreground">
        {value}
      </div>
      {subtext && (
        <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {subtext}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, message = "Нет данных", action, className }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-3 px-2 text-xs text-muted-foreground border border-dashed border-border/40 rounded-xs", className)}>
      {Icon && <Icon className="size-3.5 shrink-0 opacity-70" />}
      <span>{message}</span>
      {action}
    </div>
  );
}

export function Kbd({ children, className }) {
  return (
    <kbd className={cn("inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono font-medium rounded-xs border border-border/80 bg-muted/60 text-muted-foreground shadow-xs", className)}>
      {children}
    </kbd>
  );
}

export function StatusDot({ status = "neutral", pulse = false, className }) {
  const colors = {
    neutral: "bg-muted-foreground",
    success: "bg-bull",
    warning: "bg-warning",
    danger: "bg-bear",
    info: "bg-info",
  };
  return (
    <span className={cn("inline-flex relative size-2 shrink-0 items-center justify-center", className)}>
      {pulse && (
        <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", colors[status] || colors.neutral)} />
      )}
      <span className={cn("relative inline-flex rounded-full size-1.5", colors[status] || colors.neutral)} />
    </span>
  );
}

export function SectionHeader({ title, badge, action, className }) {
  return (
    <div className={cn("flex items-center justify-between py-1 border-b border-border/50 text-[11px] font-medium text-muted-foreground uppercase tracking-wide", className)}>
      <div className="flex items-center gap-1.5">
        <span>{title}</span>
        {badge}
      </div>
      {action}
    </div>
  );
}
