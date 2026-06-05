import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "แผนแจ้งเตือน | AI Business Owner",
  description: "ตั้งรายงาน ผู้รับ LINE วัน และเวลาของแผนแจ้งเตือนต่อร้าน",
};

export default function OwnerNotificationsPage() {
  return <OwnerPortal section="notifications" />;
}
