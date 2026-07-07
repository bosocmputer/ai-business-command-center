"use client";

type StoreSetupNavKey =
  | "ai-ceo"
  | "flowaccount"
  | "line"
  | "notifications"
  | "permissions"
  | "reports"
  | "sml"
  | "store"
  | "system";

export default function OwnerV2StoreSetupNav({
  current,
  tenantId,
}: {
  current: StoreSetupNavKey;
  tenantId: string;
}) {
  void current;
  void tenantId;
  return null;
}
