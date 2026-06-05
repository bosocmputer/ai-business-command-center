import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "Owner Admin | AI Business",
  description: "ภาพรวมตั้งค่าร้านค้า SML JavaWS, LINE OA และแผนแจ้งเตือน",
};

export default function OwnerPage() {
  return <OwnerPortal />;
}
