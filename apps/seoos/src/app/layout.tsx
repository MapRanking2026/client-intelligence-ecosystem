import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SEOOS",
  description:
    "SEO Operations System — internal SEO operations and structured intelligence packages for MTOS.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('seoos-theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');if(localStorage.getItem('seoos-annotations')==='on')document.documentElement.setAttribute('data-annotations','on');}catch(e){}})();",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
