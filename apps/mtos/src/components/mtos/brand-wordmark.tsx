import Image from "next/image";

import { cn } from "@/src/lib/utils";
// A relative path, not the `@/` alias: that alias resolves to `src/`, so `@/public/...` would be
// `src/public/...`. TypeScript accepts it and the bundler does not.
import mtosLogo from "../../../public/mtos-logo.png";

/**
 * Large logo + wordmark lockup for public/branded surfaces (sign-in, sign-up).
 *
 * ## The logo is imported, not referenced by URL
 *
 * `src="/mtos-logo.png"` was a broken image on both screens. Measured 2026-11-05: `src/proxy.ts`
 * gates every path except `_next/*` and a short allowlist on a session cookie, and a file in
 * `public/` is not on that list -- so the request was answered with the sign-in page's HTML at
 * 200, and Next's optimizer (which fetches the file back through the same proxy) then returned
 * 400 "The requested resource isn't a valid image". An empty square on the two screens everybody
 * sees before they are let in.
 *
 * Importing the file instead makes Next emit it under `/_next/static/media/`, which the proxy
 * already excludes, so it loads for a signed-out visitor. The alternative -- adding the path to
 * the proxy's public allowlist -- would have fixed the symptom by editing an authentication
 * bypass list, which is a much larger thing to get wrong for a logo. The static import also hands
 * `<Image>` the intrinsic dimensions, so the explicit width and height are no longer needed.
 */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-col items-center gap-4 text-center", className)}>
      <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-white/5 shadow-[0_24px_60px_rgba(3,10,18,0.5)]">
        <Image
          src={mtosLogo}
          alt="MTOS logo"
          sizes="80px"
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
