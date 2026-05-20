import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "LINE OA | AI Business Owner",
  description: "จัดการ LINE OA และกลุ่มรับ Morning Brief",
};

export default function OwnerLinePage() {
  return <OwnerPortal section="line" />;
}
