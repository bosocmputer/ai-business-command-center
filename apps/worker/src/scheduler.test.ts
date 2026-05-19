import { describe, expect, it } from "vitest";
import {
  getZonedMinute,
  readMorningBriefWorkerConfig,
  shouldRunMorningBrief,
} from "./scheduler.js";

describe("morning brief worker scheduler", () => {
  it("recognizes the configured 08:00 Asia/Bangkok run minute", () => {
    const now = new Date("2026-05-19T01:00:00.000Z");

    expect(getZonedMinute({ now, timeZone: "Asia/Bangkok" })).toEqual({
      date: "2026-05-19",
      time: "08:00",
    });
    expect(
      shouldRunMorningBrief({
        now,
        timeZone: "Asia/Bangkok",
        runAt: "08:00",
      }),
    ).toBe(true);
  });

  it("defaults to tenant_demo_remote and send mode", () => {
    expect(readMorningBriefWorkerConfig({})).toMatchObject({
      enabled: true,
      apiBaseUrl: "http://api:4000",
      tenantIds: ["tenant_demo_remote"],
      timeZone: "Asia/Bangkok",
      runAt: "08:00",
      mode: "send",
      force: false,
      workerId: "worker_morning_brief_1",
      heartbeatToken: null,
      adminToken: null,
    });
  });

  it("reads the shared admin token for protected mutation endpoints", () => {
    expect(
      readMorningBriefWorkerConfig({
        AI_BCC_ADMIN_TOKEN: "worker-admin-token",
      }),
    ).toMatchObject({
      adminToken: "worker-admin-token",
    });
  });
});
