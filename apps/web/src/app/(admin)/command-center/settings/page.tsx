import type { Metadata } from "next";
import CommandCenterSettings from "@/components/command-center/CommandCenterSettings";

export const metadata: Metadata = {
  title: "ตั้งค่าระบบ | AI Business Command Center",
  description: "ตรวจความพร้อมของฐานข้อมูล SML, LINE OA และงานส่งสรุปเช้า",
};

export default function CommandCenterSettingsPage() {
  return <CommandCenterSettings />;
}
