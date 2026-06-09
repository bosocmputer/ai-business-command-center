import { describe, expect, it } from "vitest";
import { buildExecutiveDigestFlexMessage } from "./line-flex.js";

describe("buildExecutiveDigestFlexMessage", () => {
  it("keeps the classic layout as the default for non-report callers", () => {
    const message = buildExecutiveDigestFlexMessage({
      title: "วันนี้มี 3 เรื่องต้องดู",
      subtitle: "DEMO SHOP",
      altText: "AI Business: action digest",
      generatedAt: "9 มิ.ย. 2026 08:00",
      status: { text: "มีข้อสังเกต", severity: "notice" },
      primaryAmount: "3 เรื่อง",
      metrics: [{ label: "แสดงใน LINE", value: "2 เรื่องแรก" }],
      insight: "เปิดภาพรวมเพื่อดูรายละเอียด",
      note: "ตัวอย่าง note classic",
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
    });
    const payload = JSON.stringify(message);

    expect(payload).toContain("วันนี้ควรรู้อะไร");
    expect(payload).toContain("3 เรื่อง");
    expect(payload).not.toContain("สิ่งที่ควรดู");
    expect(payload).not.toContain("baseline");
    expect(payload).not.toContain("executive_report_v2");
  });

  it("renders the executive report v2 hierarchy with kicker, baseline amount, and note tone", () => {
    const message = buildExecutiveDigestFlexMessage({
      variant: "executive_report_v2",
      kicker: "รับเงิน · รายวัน",
      title: "รับชำระหนี้",
      subtitle: "กระบี่ · 08/06/2026",
      altText: "รับชำระหนี้ กระบี่",
      generatedAt: "9 มิ.ย. 2026 08:01",
      status: { text: "ควรตรวจยอด", severity: "notice" },
      primaryAmount: {
        value: "2,535,461.62",
        unit: "บาท",
        compact: true,
      },
      metrics: [
        { label: "ลูกหนี้", value: "40 ราย" },
        { label: "เอกสาร", value: "54 ใบ" },
        { label: "เงินสด/โอน", value: "0.00 / 1,309,790.51 บาท" },
      ],
      insight: "พบ 11 เอกสารที่ควรตรวจช่องทางรับเงิน",
      topLine: {
        label: "ลูกหนี้รับชำระสูงสุด",
        value: "บริษัท ตัวอย่าง จำกัด: 753,754.18 บาท",
      },
      note: "รายงานนี้อิงวันที่เอกสารรับชำระ ไม่ตัดตามเวลาแจ้งเตือน",
      noteTone: "warning",
      dashboardUrl: "https://example.com/command-center/brief?token=signed",
    });
    const bubble = message.contents as any;
    const payload = JSON.stringify(message);

    expect(payload).toContain("รับเงิน · รายวัน");
    expect(payload).toContain("สิ่งที่ควรดู");
    expect(payload).toContain("baseline");
    expect(payload).toContain("2,535,461.62");
    expect(payload).toContain("บาท");
    expect(payload).toContain("เปิดรายละเอียด");
    expect(payload).toContain("#FFF7ED");
    expect(payload).not.toContain("วันนี้ควรรู้อะไร");
    expect(bubble.body.contents.length).toBeGreaterThan(5);
  });
});
