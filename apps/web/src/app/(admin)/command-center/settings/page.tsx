import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Legacy LINE Admin | AI Business",
  description: "หน้า legacy สำหรับตรวจ LINE OA และงานส่งสรุปเช้า",
};

export default function CommandCenterSettingsPage() {
  redirect("/owner/line");
}
