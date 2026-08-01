"use client";

import * as React from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface ListingImageProps {
  src?: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}

/**
 * A listing's own product image, with a neutral "Image unavailable" state when
 * the listing has no image or its image fails to load. Never substitutes a
 * random/placeholder photograph for a real listing.
 */
export function ListingImage({
  src,
  alt,
  sizes,
  priority = false,
  className,
}: ListingImageProps) {
  const [failed, setFailed] = React.useState(false);

  // A new listing/image resets the failure state.
  React.useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <div
        role="img"
        aria-label={`${alt} — image unavailable`}
        className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-muted text-muted-foreground"
      >
        <ImageOff className="h-5 w-5" aria-hidden />
        <span className="text-[0.65rem] font-medium uppercase tracking-wide">
          Image unavailable
        </span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn("object-cover", className)}
      onError={() => setFailed(true)}
    />
  );
}
