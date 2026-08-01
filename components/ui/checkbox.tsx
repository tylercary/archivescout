"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  label?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

/** Accessible checkbox built on a native input for keyboard + screen-reader support. */
export function Checkbox({
  checked,
  onCheckedChange,
  id,
  label,
  className,
  disabled,
}: CheckboxProps) {
  const reactId = React.useId();
  const inputId = id ?? reactId;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        "group flex cursor-pointer select-none items-center gap-2.5 text-sm",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <span className="relative inline-flex h-4 w-4 items-center justify-center">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="peer absolute h-4 w-4 cursor-pointer opacity-0"
        />
        <span
          aria-hidden
          className={cn(
            "flex h-4 w-4 items-center justify-center rounded-[4px] border border-input bg-card transition-colors",
            "peer-checked:border-primary peer-checked:bg-primary",
            "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-1",
          )}
        >
          {checked && <Check className="h-3 w-3 text-primary-foreground" />}
        </span>
      </span>
      {label != null && <span className="text-foreground/90">{label}</span>}
    </label>
  );
}
