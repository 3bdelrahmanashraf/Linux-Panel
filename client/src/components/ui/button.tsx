import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold tracking-[0.01em] transition-[color,background-color,border-color,box-shadow,transform] duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 motion-safe:active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-panel hover:bg-primary/90 hover:shadow-glow disabled:bg-primary/40 disabled:text-primary-foreground/70 disabled:shadow-none",
        command:
          "border border-primary/60 bg-gradient-to-br from-primary to-info text-primary-foreground shadow-panel hover:shadow-glow disabled:border-primary/20 disabled:bg-primary/35 disabled:text-primary-foreground/70 disabled:shadow-none",
        destructive:
          "bg-destructive text-destructive-foreground shadow-panel hover:brightness-110 disabled:bg-muted/30 disabled:text-muted-foreground disabled:shadow-none",
        outline:
          "border border-border/80 bg-card/60 text-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary disabled:border-border/60 disabled:bg-muted/30 disabled:text-muted-foreground",
        secondary:
          "bg-secondary/90 text-secondary-foreground hover:bg-secondary disabled:bg-secondary/70 disabled:text-muted-foreground",
        ghost: "hover:bg-primary/10 hover:text-primary disabled:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        success: "bg-success text-success-foreground shadow-panel hover:brightness-110 disabled:bg-muted/30 disabled:text-muted-foreground disabled:shadow-none",
        warning: "bg-warning text-warning-foreground shadow-panel hover:brightness-110 disabled:bg-muted/30 disabled:text-muted-foreground disabled:shadow-none",
      },
      size: {
        default: "h-11 px-4 py-2 sm:h-10",
        sm: "h-11 rounded-md px-3 text-xs sm:h-8",
        lg: "h-10 rounded-md px-8",
        icon: "h-11 w-11 sm:h-10 sm:w-10",
        iconDense: "h-11 w-11 sm:h-8 sm:w-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        data-slot="button"
        data-variant={variant ?? "default"}
        data-size={size ?? "default"}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

// eslint-disable-next-line react-refresh/only-export-components -- buttonVariants is a shared style utility, not a component
export { Button, buttonVariants }
