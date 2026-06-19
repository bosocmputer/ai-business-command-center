import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Legacy Report Admin | AI Business",
  description: "หน้า legacy สำหรับทีมดูแลรายงานระหว่างย้ายไป Owner portal",
};

export default function CommandCenterPage() {
  redirect("/owner-v2");
}
