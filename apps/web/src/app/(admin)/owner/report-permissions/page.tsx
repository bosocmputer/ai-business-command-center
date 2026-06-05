import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "สิทธิ์รายงาน | AI Business Owner",
  description: "กำหนด role รายร้านว่า LINE ID แต่ละสิทธิ์ดูรายงานใดได้บ้าง",
};

export default function OwnerReportPermissionsPage() {
  return <OwnerPortal section="report-permissions" />;
}
