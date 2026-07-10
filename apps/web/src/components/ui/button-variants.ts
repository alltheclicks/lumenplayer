import { cva } from "class-variance-authority";

export const buttonVariants = cva(
  // Transitions, active press and the layered focus glow come from the global
  // motion layer in index.css (design-system round-trip).
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 hover:-translate-y-px hover:shadow-[0_8px_24px_-8px_hsl(var(--primary)/0.6)]",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 hover:-translate-y-px hover:shadow-[0_8px_24px_-8px_hsl(var(--destructive)/0.55)]",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground hover:-translate-y-px",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:-translate-y-px",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
