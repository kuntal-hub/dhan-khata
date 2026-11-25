import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

/**
 * Buttons look like buttons: a solid (gradient) or outlined body, a raised lower edge and a
 * shadow, and they press down on tap. Tabs (underline ink) and filter chips (pill outline) are
 * styled differently on purpose (see `.tab` / `.chip` in globals.css).
 */
const buttonVariants = cva(
  "press relative inline-flex shrink-0 items-center justify-center gap-2 rounded-xl text-[15px] font-semibold whitespace-nowrap outline-none select-none focus-visible:ring-[3px] focus-visible:ring-ring/45 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default:
          "border border-[var(--primary-lo)] bg-linear-to-b from-[var(--primary-hi)] to-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.22),0_2px_0_var(--primary-lo),0_8px_18px_-8px_rgb(15_107_74/0.7)] hover:brightness-[1.06] active:translate-y-px active:shadow-[inset_0_1px_0_rgb(255_255_255/0.15),0_1px_0_var(--primary-lo)]",
        destructive:
          "border border-red-800/60 bg-linear-to-b from-red-500 to-red-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_2px_0_rgb(153_27_27),0_8px_18px_-8px_rgb(220_38_38/0.6)] hover:brightness-105 active:translate-y-px focus-visible:ring-destructive/30",
        outline:
          "border border-input bg-card text-foreground shadow-[0_2px_0_var(--input),0_4px_10px_-6px_rgb(20_40_30/0.25)] hover:border-primary/50 hover:bg-secondary/60 hover:text-secondary-foreground active:translate-y-px active:shadow-[0_1px_0_var(--input)] dark:bg-input/25",
        secondary:
          "border border-primary/20 bg-secondary text-secondary-foreground shadow-[0_2px_0_color-mix(in_oklab,var(--primary)_22%,transparent)] hover:bg-secondary/80 active:translate-y-px active:shadow-none",
        gold: "border border-[var(--gold-600)] bg-linear-to-b from-[var(--gold-300)] to-gold text-[#3b2a02] shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_2px_0_var(--gold-600),0_8px_18px_-8px_rgb(183_128_10/0.7)] hover:brightness-105 active:translate-y-px",
        ghost:
          "text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground active:bg-foreground/10",
        link: "text-primary underline underline-offset-4 decoration-primary/40 hover:decoration-primary",
      },
      size: {
        default: "h-11 px-5 has-[>svg]:px-4",
        xs: "h-7 gap-1 rounded-lg px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 gap-1.5 rounded-lg px-3.5 text-sm has-[>svg]:px-3",
        lg: "h-12 rounded-xl px-6 text-base has-[>svg]:px-5",
        icon: "size-11",
        "icon-xs": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9 rounded-lg",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
