import { cn } from "@/lib/utils";

/** Shimmering placeholder block. */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("shimmer rounded-md", className)}
      aria-hidden
      {...props}
    />
  );
}
