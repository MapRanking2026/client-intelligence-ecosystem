"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { NAV, type NavItem } from "@/src/lib/nav";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="sidebar-nav" aria-label="Primary">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`nav-link${isActive(pathname, item.href) ? " nav-link--active" : ""}`}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
        >
          <span className="nav-glyph" aria-hidden>
            {item.glyph}
          </span>
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export { NAV };
