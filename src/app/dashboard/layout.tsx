import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function DashboardDynamicLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
