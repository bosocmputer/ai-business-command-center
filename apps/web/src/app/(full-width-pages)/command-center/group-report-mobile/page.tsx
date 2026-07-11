import type { Metadata } from "next";
import GroupReportDesktopPairing from "@/components/command-center/GroupReportDesktopPairing";

export const metadata: Metadata = {
  title: "เปิดรายงานบนคอมพิวเตอร์ | AI Business Center",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GroupReportDesktopPage() {
  return <GroupReportDesktopPairing />;
}
