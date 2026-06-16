import type { ReactNode } from "react";
import OwnerV2TailAdminLayout from "@/components/owner-v2/layout/OwnerV2TailAdminLayout";

export default function OwnerV2RouteLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <OwnerV2TailAdminLayout>{children}</OwnerV2TailAdminLayout>;
}
