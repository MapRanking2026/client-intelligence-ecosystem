import type { ReactNode } from "react";

import { AppChrome } from "@/src/components/mtos/app-chrome";

interface AppShellProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}

export function AppShell({ title, subtitle, children }: AppShellProps) {
  return (
    <AppChrome title={title} subtitle={subtitle}>
      {children}
    </AppChrome>
  );
}
