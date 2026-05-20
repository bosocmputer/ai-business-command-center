import type { Metadata } from "next";
import CommandCenterDashboard from "@/components/command-center/CommandCenterDashboard";

export const metadata: Metadata = {
  title: "Legacy Report Admin | AI Business",
  description: "หน้า legacy สำหรับทีมดูแลรายงานระหว่างย้ายไป Owner portal",
};

export default function CommandCenterPage() {
  return <CommandCenterDashboard />;
}
