import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Owner Admin | AI Business",
  description: "ระบบเจ้าของสำหรับจัดการร้านค้าและ subscription",
};

export default function DashboardHome() {
  redirect("/owner");
}
