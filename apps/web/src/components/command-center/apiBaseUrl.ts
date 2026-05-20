export function getCommandCenterApiBaseUrl() {
  const rawValue = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!rawValue || rawValue === "same-origin") {
    return "";
  }

  return rawValue.replace(/\/$/, "");
}
