import { describe, expect, it } from "vitest";
import { findSensitiveTenantNoteHints } from "./index.js";

describe("tenant note safety", () => {
  it("allows normal operational onboarding notes", () => {
    expect(
      findSensitiveTenantNoteHints(
        "เจ้าของร้านคุณบอส เริ่มจากสาขากระบี่ ขอ Tomcat URL และ database เพิ่ม",
      ),
    ).toEqual([]);
  });

  it("flags common English and Thai secret labels", () => {
    expect(
      findSensitiveTenantNoteHints(
        "LINE token อยู่กับทีมไอที และรหัสผ่าน Tomcat ส่งมาในแชต",
      ),
    ).toEqual(["token", "รหัสผ่าน"]);
  });

  it("flags bearer and channel secret variants", () => {
    expect(
      findSensitiveTenantNoteHints(
        "reverse proxy bearer abc, channel_secret จะส่งตามมา",
      ),
    ).toEqual(["bearer", "channel secret"]);
  });

  it("flags long secret-like strings without returning the raw value", () => {
    const hints = findSensitiveTenantNoteHints(
      "note: abcdefghijklmnopqrstuvwxyz1234567890",
    );

    expect(hints).toEqual(["ค่าลับยาว"]);
    expect(JSON.stringify(hints)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
