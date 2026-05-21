import { Suspense } from "react";
import type { Metadata } from "next";
import CommandCenterBriefViewer, {
  CommandCenterBriefFallback,
} from "@/components/command-center/CommandCenterBriefViewer";

export const metadata: Metadata = {
  title: "รายงานผู้บริหาร | AI Business Center",
};

export default function CommandCenterBriefPage() {
  return (
    <Suspense fallback={<CommandCenterBriefFallback />}>
      <CommandCenterBriefViewer />
    </Suspense>
  );
}
