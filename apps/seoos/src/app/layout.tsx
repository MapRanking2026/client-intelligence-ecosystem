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
      <body>{children}</body>
    </html>
  );
}
