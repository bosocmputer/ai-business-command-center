import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "SML Connections | AI Business Owner",
  description: "ตั้งค่า SML datasource ต่อร้านผ่าน PostgreSQL direct หรือ Tomcat JavaWS",
};

export default function OwnerSmlConnectionsPage() {
  return <OwnerPortal section="sml-connections" />;
}
