import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { LoadingBarProvider } from "@/src/components/mtos/loading-bar";

const bodyFont = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

/**
 * Applies the saved theme before the browser paints.
 *
 * This has to run in <head>, during HTML parsing. Run from <body> it executed only after the
 * browser had already painted the light default, so every hard navigation flashed light and then
 * snapped to dark -- which reads as the theme changing by itself from page to page.
 *
 * `?theme=` is persisted rather than applied for the one page. Previously a themed link set the
 * attribute without writing to storage, so that page rendered in one theme and the next reverted
 * to the stored one. The theme now only ever changes when someone asks it to.
 *
 * `<html>` deliberately carries no data-theme. It used to, so that the server would emit an
 * explicit theme -- but naming the attribute in JSX hands it to React, which re-applies its own
 * "light" every time it re-renders the root layout: a router.refresh(), or any navigation whose
 * payload re-sends the layout. The script's "dark" was wiped on those loads and restored on the
 * next hard one, which is the flip-flop the script exists to prevent. This script is the only
 * writer now. The CSS default is light, so a first paint before it runs looks as it always did.
 */
const THEME_INIT = `(function(){try{var d=document.documentElement;var q=new URLSearchParams(location.search);var p=q.get('theme');if(p==='dark'||p==='light'){localStorage.setItem('mtos-theme',p);}d.setAttribute('data-theme',localStorage.getItem('mtos-theme')==='dark'?'dark':'light');if((q.get('anno')||localStorage.getItem('mtos-annotations'))==='on')d.setAttribute('data-annotations','on');if(q.get('hints')==='preview')d.setAttribute('data-hints','preview');}catch(e){}})();`;

export const metadata: Metadata = {
  title: "Monthly Touch OS",
  description: "AI-powered operating system for Account Managers preparing and running Monthly Touches.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${monoFont.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className="min-h-full" suppressHydrationWarning>
        <LoadingBarProvider>{children}</LoadingBarProvider>
      </body>
    </html>
  );
}
