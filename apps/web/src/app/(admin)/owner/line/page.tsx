import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "LINE OA | AI Business Owner",
  description: "จัดการ LINE OA กลาง, LINE OA ของร้าน และผู้รับแผนแจ้งเตือน",
};

export default function OwnerLinePage() {
  return <OwnerPortal section="line" />;
}
