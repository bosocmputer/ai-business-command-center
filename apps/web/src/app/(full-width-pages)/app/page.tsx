import type { Metadata } from "next";
import CustomerDashboard from "@/components/customer/CustomerDashboard";

export const metadata: Metadata = {
  title: "Customer Dashboard | AI Business",
  description: "ลิงก์ dashboard สำหรับร้านค้าแต่ละร้าน",
};

export default function CustomerAppPage() {
  return <CustomerDashboard />;
}
