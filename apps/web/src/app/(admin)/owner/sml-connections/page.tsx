import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "เชื่อม SML | AI Business Owner",
  description: "ตั้งค่า SML ต่อร้านผ่าน Tomcat JavaWS เท่านั้น",
};

export default function OwnerSmlConnectionsPage() {
  return <OwnerPortal section="sml-connections" />;
}
