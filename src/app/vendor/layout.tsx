import type { ReactNode } from "react";

export const dynamic = "force-dynamic";

export default function VendorDynamicLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
