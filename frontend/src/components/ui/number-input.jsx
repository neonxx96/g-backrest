import * as React from "react"
import { Input } from "./input"
import { cn } from "@/lib/utils"

const NumberInput = React.forwardRef(({ className, min, max, step, ...props }, ref) => {
  return (
    <Input
      type="number"
      ref={ref}
      min={min}
      max={max}
      step={step}
      className={cn("font-mono tabular-nums", className)}
      {...props}
    />
  )
})
NumberInput.displayName = "NumberInput"

export { NumberInput }
