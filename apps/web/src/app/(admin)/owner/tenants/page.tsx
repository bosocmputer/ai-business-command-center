import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "ร้านค้า | AI Business Owner",
  description: "จัดการร้านค้า subscription และ SML datasource",
};

export default function OwnerTenantsPage() {
  return <OwnerPortal section="tenants" />;
}
