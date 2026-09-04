import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const bodyFont = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const monoFont = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

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
      <body className="min-h-full" suppressHydrationWarning>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var q=new URLSearchParams(location.search);var t=q.get('theme')||localStorage.getItem('mtos-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t);if((q.get('anno')||localStorage.getItem('mtos-annotations'))==='on')document.documentElement.setAttribute('data-annotations','on');if(q.get('hints')==='preview')document.documentElement.setAttribute('data-hints','preview');}catch(e){}})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
