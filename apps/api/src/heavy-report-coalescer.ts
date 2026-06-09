import type {
  ReportKey,
  SalesGoodsServicesParams,
  TenantId,
} from "@ai-bcc/shared";

export type HeavyReportCoalescedResult<T> = {
  value: T;
  coalesced: boolean;
};

type ActiveHeavyExecution<T> = {
  promise: Promise<T>;
};

export function createHeavyReportCoalescer<T>() {
  const activeByKey = new Map<string, ActiveHeavyExecution<T>>();
  const tenantChains = new Map<TenantId, Promise<void>>();

  return {
    activeCount() {
      return activeByKey.size;
    },

    async run(input: {
      tenantId: TenantId;
      reportKey: ReportKey;
      params: SalesGoodsServicesParams;
      runner: () => Promise<T>;
    }): Promise<HeavyReportCoalescedResult<T>> {
      const key = buildHeavyReportExecutionKey(input);
      const active = activeByKey.get(key);
      if (active) {
        return {
          value: await active.promise,
          coalesced: true,
        };
      }

      const previousTenantExecution = tenantChains.get(input.tenantId);
      const promise = (async () => {
        if (previousTenantExecution) {
          await previousTenantExecution.catch(() => undefined);
        }
        return input.runner();
      })();
      activeByKey.set(key, { promise });

      const tenantExecution = promise.then(
        () => undefined,
        () => undefined,
      );
      tenantChains.set(input.tenantId, tenantExecution);
      tenantExecution.finally(() => {
        if (tenantChains.get(input.tenantId) === tenantExecution) {
          tenantChains.delete(input.tenantId);
        }
      });
      promise.then(
        () => {
          if (activeByKey.get(key)?.promise === promise) {
            activeByKey.delete(key);
          }
        },
        () => {
          if (activeByKey.get(key)?.promise === promise) {
            activeByKey.delete(key);
          }
        },
      );

      return {
        value: await promise,
        coalesced: false,
      };
    },
  };
}

function buildHeavyReportExecutionKey(input: {
  tenantId: TenantId;
  reportKey: ReportKey;
  params: SalesGoodsServicesParams;
}) {
  return [
    input.tenantId,
    input.reportKey,
    stableJsonStringify(normalizeReportParams(input.params)),
  ].join("|");
}

export function normalizeReportParams(params: SalesGoodsServicesParams) {
  return {
    date_from: params.date_from,
    date_to: params.date_to,
    time_from: params.time_from ?? null,
    time_to: params.time_to ?? null,
  };
}

export function sameReportParams(
  left: SalesGoodsServicesParams,
  right: SalesGoodsServicesParams,
) {
  return (
    stableJsonStringify(normalizeReportParams(left)) ===
    stableJsonStringify(normalizeReportParams(right))
  );
}

function stableJsonStringify(value: Record<string, unknown>) {
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = value[key];
        return acc;
      }, {}),
  );
}
