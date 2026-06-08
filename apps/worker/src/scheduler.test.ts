import { describe, expect, it } from "vitest";
import {
  getZonedMinute,
  readNotificationRulesWorkerConfig,
  shouldRunMorningBrief,
} from "./scheduler.js";

describe("notification rule worker scheduler", () => {
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

  it("uses DB-backed notification rules without tenant/time env defaults", () => {
    expect(readNotificationRulesWorkerConfig({})).toMatchObject({
      enabled: true,
      apiBaseUrl: "http://api:4000",
      catchUpMinutes: 15,
      mode: "send",
      workerId: "worker_notification_rules_1",
      heartbeatToken: null,
    });
  });

  it("bounds notification catch-up minutes from env", () => {
    expect(
      readNotificationRulesWorkerConfig({
        WORKER_NOTIFICATION_CATCH_UP_MINUTES: "90",
      }).catchUpMinutes,
    ).toBe(60);
    expect(
      readNotificationRulesWorkerConfig({
        WORKER_NOTIFICATION_CATCH_UP_MINUTES: "-3",
      }).catchUpMinutes,
    ).toBe(0);
  });
});
