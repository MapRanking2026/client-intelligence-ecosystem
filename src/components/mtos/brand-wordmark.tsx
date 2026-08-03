import Image from "next/image";

import { cn } from "@/src/lib/utils";

/**
 * Large logo + wordmark lockup for public/branded surfaces (sign-in, sign-up).
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-4 text-center", className)}>
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-[0_24px_60px_rgba(3,10,18,0.5)]">
        <Image
          src="/mtos-logo.png"
          alt="MTOS logo"
          width={80}
          height={80}
          className="h-full w-full object-contain"
          priority
        />
      </div>
      <div>
        <p className="font-serif text-3xl tracking-tight text-white md:text-4xl">Monthly Touch OS</p>
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.34em] text-slate-400">MTOS</p>
      </div>
    </div>
  );
}
