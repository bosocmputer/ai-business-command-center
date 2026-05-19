import type { Metadata } from "next";
import CommandCenterDashboard from "@/components/command-center/CommandCenterDashboard";

export const metadata: Metadata = {
  title: "แดชบอร์ดยอดขาย SML | AI Business Command Center",
  description: "แดชบอร์ดยอดขายสินค้าและบริการสำหรับลูกค้า SML",
};

export default function CommandCenterPage() {
  return <CommandCenterDashboard />;
}
