import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "ร้านค้า | AI Business Owner",
  description: "จัดการร้านค้า subscription readiness และ dashboard link",
};

export default function OwnerTenantsPage() {
  redirect("/owner");
}
