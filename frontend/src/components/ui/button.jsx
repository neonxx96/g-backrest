import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground data-[active=true]:border-primary/60",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-transparent hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        subtle: "border border-border/60 bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground text-muted-foreground",
        accent: "bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-7 px-2.5 text-xs",
        xs: "h-6 px-2 text-[11px] [&_svg]:size-3.5",
        sm: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
        md: "h-8 px-3 text-xs [&_svg]:size-4",
        lg: "h-9 px-4 text-sm [&_svg]:size-4",
        icon: "h-7 w-7 [&_svg]:size-3.5",
        "icon-xs": "h-6 w-6 [&_svg]:size-3.5",
        "icon-sm": "h-7 w-7 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "sm",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
