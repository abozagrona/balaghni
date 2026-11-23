import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function VerifyDynamicLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
