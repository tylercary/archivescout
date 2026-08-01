import Link from "next/link";
import { cn } from "@/lib/utils";

/** ArchiveScout wordmark. Editorial serif "Archive" + light "Scout". */
export function Logo({
  className,
  href = "/",
}: {
  className?: string;
  href?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="ArchiveScout home"
      className={cn(
        "group inline-flex items-baseline gap-[1px] text-xl tracking-tight",
        className,
      )}
    >
      <span className="font-display font-semibold text-foreground">Archive</span>
      <span className="font-light text-muted-foreground transition-colors group-hover:text-foreground">
        Scout
      </span>
    </Link>
  );
}
