import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function ActivateSecurityDynamicLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
