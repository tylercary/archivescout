"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  side?: "left" | "right" | "bottom";
  className?: string;
  label: string;
}

const sideClasses: Record<NonNullable<SheetProps["side"]>, string> = {
  left: "inset-y-0 left-0 h-full w-[86%] max-w-sm border-r",
  right: "inset-y-0 right-0 h-full w-[86%] max-w-md border-l",
  bottom: "inset-x-0 bottom-0 max-h-[85vh] w-full rounded-t-2xl border-t",
};

const sideAnim: Record<NonNullable<SheetProps["side"]>, string> = {
  left: "animate-slide-in-right [--tw-enter-translate-x:-100%]",
  right: "animate-slide-in-right",
  bottom: "animate-fade-in",
};

/** Slide-in panel used for mobile filters and the compare drawer. */
export function Sheet({
  open,
  onClose,
  children,
  side = "right",
  className,
  label,
}: SheetProps) {
  const [mounted, setMounted] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      <button
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="fixed inset-0 cursor-default bg-foreground/40 backdrop-blur-[2px] animate-fade-in"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "absolute z-10 flex flex-col bg-card shadow-2xl outline-none border-border",
          sideClasses[side],
          sideAnim[side],
          className,
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          shape="pill"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 z-20"
        >
          <X className="h-4 w-4" />
        </Button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
