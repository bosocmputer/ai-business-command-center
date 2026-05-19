import type { Metadata } from "next";
import React from "react";
import CommandCenterDashboard from "@/components/command-center/CommandCenterDashboard";

export const metadata: Metadata = {
  title: "AI Business Command Center | SML Dashboard",
  description: "Sales goods and services dashboard for SML tenants",
};

export default function DashboardHome() {
  return <CommandCenterDashboard />;
}
