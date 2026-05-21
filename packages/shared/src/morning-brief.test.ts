import { describe, expect, it } from "vitest";
import { deriveMorningBriefDateRange, getSmlBranchMeaning } from "./index.js";

describe("deriveMorningBriefDateRange", () => {
  it("uses yesterday in Asia/Bangkok as a single-day report period", () => {
    expect(
      deriveMorningBriefDateRange({
        period: "yesterday",
        now: new Date("2026-05-19T01:00:00.000Z"),
        timeZone: "Asia/Bangkok",
      }),
    ).toEqual({
      date_from: "2026-05-18",
      date_to: "2026-05-18",
    });
  });
});

describe("getSmlBranchMeaning", () => {
  it("uses erp_branch_list name before code fallback", () => {
    expect(getSmlBranchMeaning("0000", "สำนักงาน")).toEqual({
      code: "0000",
      label: "สำนักงาน",
      name: "สำนักงาน",
      note: "ชื่อสาขาจาก erp_branch_list (0000)",
      is_unmapped: false,
    });
  });
});
