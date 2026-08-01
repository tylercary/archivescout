"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  label: string; // accessible name
}

/** Centered modal dialog with backdrop, escape-to-close, and scroll lock. */
export function Dialog({ open, onClose, children, className, label }: DialogProps) {
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
    // Move focus into the dialog for keyboard users.
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center sm:p-6"
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
          "relative z-10 my-auto w-full max-w-4xl rounded-lg border border-border bg-card shadow-2xl outline-none animate-fade-in",
          className,
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          shape="pill"
          aria-label="Close"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 bg-card/80 backdrop-blur hover:bg-accent"
        >
          <X className="h-4 w-4" />
        </Button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
