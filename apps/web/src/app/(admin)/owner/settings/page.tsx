import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "ตั้งค่าระบบ | AI Business Owner",
  description: "จัดการ runtime settings และ bootstrap status ของระบบ",
};

export default function OwnerSettingsPage() {
  return <OwnerPortal section="settings" />;
}
