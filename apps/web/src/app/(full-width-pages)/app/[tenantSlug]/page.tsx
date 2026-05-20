import type { Metadata } from "next";
import CustomerDashboard from "@/components/customer/CustomerDashboard";

export const metadata: Metadata = {
  title: "Customer Dashboard | AI Business",
  description: "Dashboard อ่านรายงานอย่างเดียวสำหรับร้านค้า",
};

type CustomerTenantPageProps = {
  params: Promise<{
    tenantSlug: string;
  }>;
};

export default async function CustomerTenantPage({
  params,
}: CustomerTenantPageProps) {
  const { tenantSlug } = await params;
  return <CustomerDashboard tenantSlug={tenantSlug} />;
}
