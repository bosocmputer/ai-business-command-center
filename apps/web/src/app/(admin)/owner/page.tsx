import type { Metadata } from "next";
import OwnerPortal from "@/components/owner/OwnerPortal";

export const metadata: Metadata = {
  title: "Owner Admin | AI Business",
  description: "จัดการร้านค้า subscription, SML datasource และ LINE OA",
};

export default function OwnerPage() {
  return <OwnerPortal />;
}
