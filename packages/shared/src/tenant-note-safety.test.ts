import { describe, expect, it } from "vitest";
import {
  findSensitiveTenantNoteHints,
  suggestTenantIdFromName,
  tenantIdSchema,
} from "./index.js";

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

describe("tenant id suggestion", () => {
  it("suggests readable ids for English store names", () => {
    expect(suggestTenantIdFromName("Sea & Hill 2")).toBe("tenant_sea_and_hill_2");
  });

  it("suggests valid stable ids for Thai store names", () => {
    const suggestion = suggestTenantIdFromName("กระบี่");

    expect(suggestion).toMatch(/^tenant_store_[a-z0-9]{6,8}$/);
    expect(suggestion).toBe(suggestTenantIdFromName("กระบี่"));
    expect(() => tenantIdSchema.parse(suggestion)).not.toThrow();
  });

  it("keeps generated ids within schema length", () => {
    const suggestion = suggestTenantIdFromName("Very Long Shop Name ".repeat(12));

    expect(suggestion.length).toBeLessThanOrEqual(80);
    expect(() => tenantIdSchema.parse(suggestion)).not.toThrow();
  });

  it("returns an empty suggestion for blank input", () => {
    expect(suggestTenantIdFromName("   ")).toBe("");
  });
});
