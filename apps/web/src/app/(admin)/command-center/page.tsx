import type { Metadata } from "next";
import CommandCenterDashboard from "@/components/command-center/CommandCenterDashboard";

export const metadata: Metadata = {
  title: "AI Business Command Center | SML Dashboard",
  description: "Sales goods and services dashboard for SML tenants",
};

export default function CommandCenterPage() {
  return <CommandCenterDashboard />;
}
