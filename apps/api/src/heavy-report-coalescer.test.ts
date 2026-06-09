import { describe, expect, it } from "vitest";
import { createHeavyReportCoalescer } from "./heavy-report-coalescer.js";

describe("heavy report coalescer", () => {
  it("reuses an active matching tenant/report/params execution", async () => {
    const coalescer = createHeavyReportCoalescer<string>();
    let calls = 0;
    const deferred = createDeferred<string>();
    const runner = () => {
      calls += 1;
      return deferred.promise;
    };

    const first = coalescer.run({
      tenantId: "tenant_demo_remote",
      reportKey: "stock_balance",
      params: {
        date_from: "2026-06-08",
        date_to: "2026-06-08",
        time_from: "00:00",
        time_to: "23:59",
      },
      runner,
    });
    const second = coalescer.run({
      tenantId: "tenant_demo_remote",
      reportKey: "stock_balance",
      params: {
        date_from: "2026-06-08",
        date_to: "2026-06-08",
        time_from: "00:00",
        time_to: "23:59",
      },
      runner,
    });

    expect(calls).toBe(1);
    deferred.resolve("ok");
    await expect(first).resolves.toEqual({ value: "ok", coalesced: false });
    await expect(second).resolves.toEqual({ value: "ok", coalesced: true });
    expect(coalescer.activeCount()).toBe(0);
  });

  it("serializes different heavy reports for the same tenant", async () => {
    const coalescer = createHeavyReportCoalescer<string>();
    const events: string[] = [];
    const firstDeferred = createDeferred<string>();

    const first = coalescer.run({
      tenantId: "tenant_demo_remote",
      reportKey: "stock_balance",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      runner: () => {
        events.push("stock:start");
        return firstDeferred.promise;
      },
    });
    const second = coalescer.run({
      tenantId: "tenant_demo_remote",
      reportKey: "ar_customer_movement",
      params: { date_from: "2026-06-08", date_to: "2026-06-08" },
      runner: async () => {
        events.push("ar:start");
        return "ar";
      },
    });

    await Promise.resolve();
    expect(events).toEqual(["stock:start"]);
    firstDeferred.resolve("stock");
    await expect(first).resolves.toEqual({
      value: "stock",
      coalesced: false,
    });
    await expect(second).resolves.toEqual({ value: "ar", coalesced: false });
    expect(events).toEqual(["stock:start", "ar:start"]);
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}
