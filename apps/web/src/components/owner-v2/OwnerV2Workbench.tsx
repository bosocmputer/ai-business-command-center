"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import {
  AlertIcon,
  CheckCircleIcon,
  InfoIcon,
  PlusIcon,
} from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import type {
  OwnerV2LineSetupPayload,
  OwnerV2NotificationSetupPayload,
  OwnerV2PermissionSetupPayload,
  OwnerV2ReportSetupPayload,
  OwnerV2SetupStep,
  OwnerV2SmlSetupPayload,
  OwnerV2StepId,
  OwnerV2Tenant,
  OwnerV2WorkbenchPayload,
} from "./types";

type DetailState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "success";
      step: OwnerV2StepId;
      data:
        | OwnerV2SmlSetupPayload
        | OwnerV2ReportSetupPayload
        | OwnerV2LineSetupPayload
        | OwnerV2NotificationSetupPayload
        | OwnerV2PermissionSetupPayload
        | null;
    };

const stepOrder: OwnerV2StepId[] = [
  "store",
  "sml",
  "reports",
  "line",
  "permissions",
  "notifications",
];

const stepLabels: Record<OwnerV2StepId, string> = {
  store: "ร้าน",
  sml: "SML",
  reports: "รายงาน",
  line: "LINE",
  permissions: "สิทธิ์",
  notifications: "แจ้งเตือน",
};

const primaryActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-theme-sm font-medium text-white shadow-theme-xs transition hover:bg-brand-600 sm:w-auto";

const secondaryActionClass =
  "inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200 sm:w-auto";

export default function OwnerV2Workbench() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryTenantId = searchParams.get("tenant") ?? "";
  const queryStep = parseStep(searchParams.get("step"));
  const initialTenantId = queryTenantId;
  const initialStep = queryStep;
  const [selectedTenantId, setSelectedTenantId] = useState(initialTenantId);
  const [activeStep, setActiveStep] = useState<OwnerV2StepId>(initialStep);
  const activeStepRef = useRef<OwnerV2StepId>(initialStep);
  const [tenantSearch, setTenantSearch] = useState("");
  const [workbench, setWorkbench] = useState<OwnerV2WorkbenchPayload | null>(
    null,
  );
  const [status, setStatus] = useState<
    "loading" | "success" | "error" | "auth_required"
  >("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [detailState, setDetailState] = useState<DetailState>({
    status: "idle",
  });

  const selectedTenant = workbench?.selected?.tenant ?? null;
  const selectedSteps = workbench?.selected?.steps ?? [];
  const filteredTenants = useMemo(() => {
    const query = normalizeText(tenantSearch);
    const tenants = workbench?.tenants ?? [];
    if (!query) {
      return tenants;
    }
    return tenants.filter((tenant) =>
      normalizeText(`${tenant.name} ${tenant.id} ${tenant.status}`).includes(
        query,
      ),
    );
  }, [tenantSearch, workbench?.tenants]);

  const syncUrl = useCallback(
    (tenantId: string, step: OwnerV2StepId) => {
      const params = new URLSearchParams();
      if (tenantId) {
        params.set("tenant", tenantId);
      }
      if (step !== "store") {
        params.set("step", step);
      }
      router.replace(`/owner-v2${params.size ? `?${params.toString()}` : ""}`, {
        scroll: false,
      });
    },
    [router],
  );

  useEffect(() => {
    activeStepRef.current = activeStep;
  }, [activeStep]);

  useEffect(() => {
    if (queryTenantId !== selectedTenantId) {
      setSelectedTenantId(queryTenantId);
      setDetailState({ status: "idle" });
    }
    if (queryStep !== activeStepRef.current) {
      setActiveStep(queryStep);
    }
  }, [queryStep, queryTenantId, selectedTenantId]);

  const loadWorkbench = useCallback(
    async (tenantId: string, signal?: AbortSignal) => {
      setStatus("loading");
      setErrorMessage("");
      const query = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
      try {
        const data = await ownerV2Fetch<OwnerV2WorkbenchPayload>(
          `/api/owner/workbench${query}`,
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        setWorkbench(data);
        setStatus("success");
        const resolvedTenantId = data.selected_tenant_id ?? "";
        if (resolvedTenantId && resolvedTenantId !== tenantId) {
          setSelectedTenantId(resolvedTenantId);
          syncUrl(resolvedTenantId, activeStepRef.current);
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        const statusCode = (error as Error & { status?: number }).status;
        if (statusCode === 401 || statusCode === 403) {
          setStatus("auth_required");
          setErrorMessage("Session ผู้ดูแลหมดอายุ กรุณาเข้าสู่ระบบใหม่");
          return;
        }
        setStatus("error");
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "โหลด Owner Workbench ไม่สำเร็จ",
        );
      }
    },
    [syncUrl],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadWorkbench(selectedTenantId, controller.signal);
    return () => controller.abort();
  }, [loadWorkbench, selectedTenantId]);

  const loadStepDetail = useCallback(
    async (
      tenantId: string,
      step: OwnerV2StepId,
      signal?: AbortSignal,
    ) => {
      if (step === "store") {
        setDetailState({ status: "success", step, data: null });
        return;
      }
      setDetailState({ status: "loading" });
      try {
        const path = detailEndpointForStep(tenantId, step);
        const data = await ownerV2Fetch<
          | OwnerV2SmlSetupPayload
          | OwnerV2ReportSetupPayload
          | OwnerV2LineSetupPayload
          | OwnerV2NotificationSetupPayload
          | OwnerV2PermissionSetupPayload
        >(path, { signal });
        if (signal?.aborted) {
          return;
        }
        setDetailState({ status: "success", step, data });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setDetailState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดรายละเอียดขั้นตอนนี้ไม่สำเร็จ",
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!selectedTenant) {
      setDetailState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    void loadStepDetail(selectedTenant.id, activeStep, controller.signal);
    return () => controller.abort();
  }, [activeStep, loadStepDetail, selectedTenant]);

  const handleTenantSelect = (tenantId: string) => {
    setSelectedTenantId(tenantId);
    setActiveStep("store");
    setDetailState({ status: "idle" });
    syncUrl(tenantId, "store");
  };

  const handleStepSelect = (step: OwnerV2StepId) => {
    setActiveStep(step);
    syncUrl(selectedTenantId, step);
  };

  if (status === "auth_required") {
    return (
      <WorkbenchMessage
        actionHref="/signin"
        actionLabel="เข้าสู่ระบบใหม่"
        message={errorMessage}
        title="ต้องเข้าสู่ระบบผู้ดูแล"
        tone="warning"
      />
    );
  }

  if (status === "error") {
    return (
      <WorkbenchMessage
        actionLabel="รีเฟรช Workbench"
        message={errorMessage}
        onAction={() => void loadWorkbench(selectedTenantId)}
        title="โหลด Owner Workbench ไม่สำเร็จ"
        tone="error"
      />
    );
  }

  if (status === "loading" && !workbench) {
    return <WorkbenchSkeleton />;
  }

  if (workbench && workbench.tenants.length === 0) {
    return (
      <WorkbenchMessage
        actionHref="/owner-v2/stores/new"
        actionLabel="เพิ่มร้านแรก"
        message="ยังไม่มีร้านในระบบ เริ่มจากสร้างร้านแล้วค่อยเชื่อม SML และ LINE"
        title="ยังไม่มีร้านให้จัดการ"
        tone="info"
      />
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
        <div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
                ร้านค้า
              </h2>
              <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                เลือกร้านเพื่อดูงานถัดไป
              </p>
            </div>
            <Link
              className={primaryActionClass}
              href="/owner-v2/stores/new"
            >
              <PlusIcon className="h-4 w-4" />
              เพิ่มร้าน
            </Link>
          </div>
          <input
            className="mt-4 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-theme-sm text-gray-800 shadow-theme-xs outline-hidden transition placeholder:text-gray-400 focus:border-brand-300 focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
            onChange={(event) => setTenantSearch(event.target.value)}
            placeholder="ค้นหาชื่อร้านหรือ tenant id"
            value={tenantSearch}
          />
        </div>
        <div className="custom-scrollbar mt-4 flex max-h-[680px] flex-col gap-2 overflow-y-auto">
          {filteredTenants.map((tenant) => (
            <TenantRow
              key={tenant.id}
              onSelect={handleTenantSelect}
              selected={tenant.id === selectedTenant?.id}
              tenant={tenant}
            />
          ))}
          {!filteredTenants.length ? (
            <div className="rounded-lg bg-gray-50 px-4 py-6 text-center dark:bg-white/[0.02]">
              <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                ไม่พบร้านที่ตรงกับคำค้น
              </p>
              <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                ลองล้างคำค้นหา หรือเพิ่มร้านใหม่
              </p>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="space-y-6">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-theme-xl font-semibold text-gray-800 dark:text-white/90">
                  {selectedTenant?.name ?? "เลือกร้าน"}
                </h2>
                {selectedTenant ? (
                  <StatusBadge status={selectedTenant.status} />
                ) : null}
                {selectedTenant ? (
                  <Badge color={selectedTenant.ready ? "success" : "warning"}>
                    {selectedTenant.completed_steps}/
                    {selectedTenant.total_steps} พร้อม
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                {workbench?.selected?.access_message ??
                  "เลือกหรือเพิ่มร้านเพื่อเริ่มตั้งค่า"}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <Button
                className="w-full sm:w-auto"
                onClick={() => void loadWorkbench(selectedTenantId)}
                size="sm"
                type="button"
                variant="outline"
              >
                รีเฟรช
              </Button>
              {selectedTenant?.dashboard_path ? (
                <Link
                  className={secondaryActionClass}
                  href={selectedTenant.dashboard_path}
                >
                  เปิดหน้าลูกค้า
                </Link>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Fact
              label="Ops warning"
              value={`${workbench?.ops.warning_count ?? 0} รายการ`}
            />
            <Fact
              label="Worker"
              value={formatWorkerStatus(workbench?.ops.worker_status)}
            />
            <Fact
              label="Telegram ops"
              value={workbench?.ops.telegram_ready ? "พร้อมแจ้งเตือน" : "ยังไม่พร้อม"}
            />
          </div>

          {workbench?.selected?.next_action ? (
            <div className="mt-5 rounded-xl border border-warning-500 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/15">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                    สิ่งที่ควรทำต่อ: {workbench.selected.next_action.label}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                    {workbench.selected.next_action.detail}
                  </p>
                </div>
                <Button
                  className="w-full shrink-0 md:w-auto"
                  onClick={() =>
                    handleStepSelect(workbench.selected!.next_action!.step)
                  }
                  size="sm"
                  type="button"
                >
                  {workbench.selected.next_action.action_label}
                </Button>
              </div>
            </div>
          ) : selectedTenant ? (
            <div className="mt-5">
              <InlineNotice
                message="ตรวจรอบแจ้งเตือนและเปิดหน้าลูกค้าได้เลย"
                title="ร้านนี้พร้อมใช้งานแล้ว"
                tone="success"
              />
            </div>
          ) : null}
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">
              ขั้นตอนตั้งค่าร้าน
            </h2>
            <p className="mt-1 text-theme-sm text-gray-500 dark:text-gray-400">
              เปิดเฉพาะขั้นที่ต้องดู ระบบจะโหลดรายละเอียดของขั้นนั้นเท่านั้น
            </p>
          </div>
          <div className="grid gap-4 2xl:grid-cols-[300px_minmax(0,1fr)]">
            <div className="rounded-xl bg-gray-50 p-2 dark:bg-white/[0.02]">
              {stepOrder.map((stepId) => {
                const step =
                  selectedSteps.find((item) => item.step === stepId) ??
                  fallbackStep(stepId);
                return (
                  <StepButton
                    active={activeStep === stepId}
                    key={stepId}
                    onClick={() => handleStepSelect(stepId)}
                    step={step}
                  />
                );
              })}
            </div>
            <div className="min-w-0">
              <StepDetail
                activeStep={activeStep}
                detailState={detailState}
                selectedTenant={selectedTenant}
              />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function TenantRow({
  onSelect,
  selected,
  tenant,
}: {
  onSelect: (tenantId: string) => void;
  selected: boolean;
  tenant: OwnerV2Tenant;
}) {
  return (
    <button
      className={`w-full rounded-lg p-3 text-left transition ${
        selected
          ? "bg-brand-50 ring-1 ring-brand-100 dark:bg-brand-500/10 dark:ring-brand-500/20"
          : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
      }`}
      onClick={() => onSelect(tenant.id)}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
            {tenant.name}
          </p>
          <p className="mt-1 truncate text-theme-xs text-gray-500 dark:text-gray-400">
            {tenant.id}
          </p>
        </div>
        <Badge color={tenant.ready ? "success" : "warning"} size="sm">
          {tenant.completed_steps}/{tenant.total_steps}
        </Badge>
      </div>
      <p className="mt-2 text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
        {tenant.next_action?.label ?? "พร้อมใช้งาน"}
      </p>
    </button>
  );
}

function StepButton({
  active,
  onClick,
  step,
}: {
  active: boolean;
  onClick: () => void;
  step: OwnerV2SetupStep;
}) {
  return (
    <button
      className={`flex w-full items-start gap-3 rounded-lg p-3 text-left transition ${
        active
          ? "bg-brand-50 ring-1 ring-brand-100 dark:bg-brand-500/10 dark:ring-brand-500/20"
          : "hover:bg-gray-50 dark:hover:bg-white/[0.03]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          step.ok
            ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
            : "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-300"
        }`}
      >
        {step.ok ? (
          <CheckCircleIcon className="h-4 w-4" />
        ) : (
          <AlertIcon className="h-4 w-4" />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-theme-sm font-medium text-gray-800 dark:text-white/90">
          {stepLabels[step.step]}
        </span>
        <span className="mt-0.5 block text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
          {step.detail}
        </span>
      </span>
    </button>
  );
}

function StepDetail({
  activeStep,
  detailState,
  selectedTenant,
}: {
  activeStep: OwnerV2StepId;
  detailState: DetailState;
  selectedTenant: OwnerV2Tenant | null;
}) {
  if (!selectedTenant) {
    return (
      <div className="p-5 text-sm text-gray-500 dark:text-gray-400">
        เลือกร้านทางซ้ายเพื่อดูขั้นตอนตั้งค่า
      </div>
    );
  }
  if (detailState.status === "loading") {
    return <DetailSkeleton />;
  }
  if (detailState.status === "error") {
    return (
      <div className="p-5">
        <InlineNotice
          message={`${detailState.message} ลองรีเฟรช หรือเปิดขั้นตอนนี้อีกครั้ง`}
          tone="error"
          title="โหลดรายละเอียดไม่สำเร็จ"
        />
      </div>
    );
  }
  if (activeStep === "store") {
    return <StoreStep selectedTenant={selectedTenant} />;
  }
  if (detailState.status !== "success") {
    return <DetailSkeleton />;
  }
  if (activeStep === "sml") {
    return (
      <SmlStep
        data={detailState.data as OwnerV2SmlSetupPayload}
        tenantId={selectedTenant.id}
      />
    );
  }
  if (activeStep === "reports") {
    return (
      <ReportStep
        data={detailState.data as OwnerV2ReportSetupPayload}
        tenantId={selectedTenant.id}
      />
    );
  }
  if (activeStep === "line") {
    return (
      <LineStep
        data={detailState.data as OwnerV2LineSetupPayload}
        tenantId={selectedTenant.id}
      />
    );
  }
  if (activeStep === "permissions") {
    return (
      <PermissionStep
        data={detailState.data as OwnerV2PermissionSetupPayload}
        tenantId={selectedTenant.id}
      />
    );
  }
  return (
    <NotificationStep
      data={detailState.data as OwnerV2NotificationSetupPayload}
      tenantId={selectedTenant.id}
    />
  );
}

function StoreStep({ selectedTenant }: { selectedTenant: OwnerV2Tenant }) {
  return (
    <div className="space-y-4 p-5">
      <div>
        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
          ข้อมูลร้านและสถานะใช้งาน
        </h3>
        <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
          ใช้ตรวจว่าร้านเปิดใช้งานอยู่หรือไม่ ก่อนเริ่มตั้งค่า SML และ LINE
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Fact label="Plan" value={selectedTenant.plan_code} />
        <Fact label="สถานะร้าน" value={formatTenantStatus(selectedTenant.status)} />
        <Fact
          label="ความพร้อม"
          value={`${selectedTenant.completed_steps}/${selectedTenant.total_steps}`}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Link
          className={secondaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(selectedTenant.id)}`}
        >
          เปิดหน้าร้าน
        </Link>
        {selectedTenant.dashboard_path ? (
          <Link
            className={primaryActionClass}
            href={selectedTenant.dashboard_path}
          >
            เปิด dashboard ลูกค้า
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function SmlStep({
  data,
  tenantId,
}: {
  data: OwnerV2SmlSetupPayload;
  tenantId: string;
}) {
  const datasource = data.datasource;
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            SML JavaWS
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            แสดงเฉพาะสถานะ config ที่ปลอดภัย ไม่แสดง password หรือ token
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/sml`}
        >
          เปิดฟอร์ม SML
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Fact label="แหล่ง config" value={formatDatasourceSource(datasource.source)} />
        <Fact label="ชนิด datasource" value={datasource.kind ?? "ยังไม่ตั้ง"} />
        <Fact label="Database" value={datasource.database ?? "ยังไม่ระบุ"} />
        <Fact label="SMLConfig" value={datasource.config_file_name ?? "ยังไม่ระบุ"} />
        <Fact
          label="Auth"
          value={datasource.auth_configured ? "ตั้งค่าแล้ว" : "ไม่ใช้ auth"}
        />
        <Fact
          label="อัปเดตล่าสุด"
          value={formatDateTime(datasource.updated_at)}
        />
      </div>
      {data.latest_report_run ? (
        <InlineNotice
          message={`${data.latest_report_run.report_key} · ${formatDateTime(
            data.latest_report_run.finished_at ??
              data.latest_report_run.started_at,
          )} · ${data.latest_report_run.row_count.toLocaleString("th-TH")} rows`}
          title={`รายงานล่าสุด: ${formatReportRunStatus(data.latest_report_run.status)}`}
          tone={data.latest_report_run.status === "success" ? "success" : "warning"}
        />
      ) : (
        <InlineNotice
          message="ยังไม่มี report run ล่าสุด กดรันรายงานทดสอบก่อนเปิดแผนแจ้งเตือน"
          title="ยังไม่มีหลักฐานรายงาน"
          tone="warning"
        />
      )}
    </div>
  );
}

function ReportStep({
  data,
  tenantId,
}: {
  data: OwnerV2ReportSetupPayload;
  tenantId: string;
}) {
  const latestRun = data.latest_runs[0] ?? null;
  const heavyReports = data.reports.filter((report) => report.heavy);
  const asyncHeavyReports = heavyReports.filter((report) => report.async_supported);
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            ทดสอบรายงาน
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ใช้ตรวจว่ารายงานรันสำเร็จจริงก่อนเปิดแจ้งเตือนประจำวัน
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/reports`}
        >
          รันรายงานทดสอบ
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Fact label="รายงานทั้งหมด" value={`${data.reports.length} รายงาน`} />
        <Fact
          label="Heavy report"
          value={`${heavyReports.length} รายงาน`}
        />
        <Fact
          label="Chunked runner"
          value={
            data.tenant.feature_flags.sml_chunked_heavy_reports_enabled
              ? "เปิดใช้งาน"
              : "ยังปิดอยู่"
          }
        />
        <Fact
          label="Snapshot ล่าสุด"
          value={`${data.latest_snapshots.length} รายงาน`}
        />
      </div>
      {latestRun ? (
        <InlineNotice
          message={`${latestRun.report_key} · ${formatDateTime(
            latestRun.finished_at ?? latestRun.started_at,
          )} · ${latestRun.row_count.toLocaleString("th-TH")} rows${
            latestRun.failure_phase ? ` · phase ${latestRun.failure_phase}` : ""
          }`}
          title={`รายงานล่าสุด: ${formatReportRunStatus(latestRun.status)}`}
          tone={latestRun.status === "success" ? "success" : "warning"}
        />
      ) : (
        <InlineNotice
          message="ยังไม่มี report run ล่าสุด กดรันรายงานทดสอบก่อนเปิดแผนแจ้งเตือน"
          title="ยังไม่มีหลักฐานรายงาน"
          tone="warning"
        />
      )}
      {asyncHeavyReports.length ? (
        <InlineNotice
          message={`${asyncHeavyReports
            .map((report) => report.short_label)
            .join(", ")} รองรับ async/chunked เพื่อลด timeout ของ SML JavaWS`}
          title="Heavy report พร้อมรันแบบ async"
          tone="info"
        />
      ) : null}
    </div>
  );
}

function LineStep({
  data,
  tenantId,
}: {
  data: OwnerV2LineSetupPayload;
  tenantId: string;
}) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            LINE OA และผู้รับ
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            เช็ค token, secret และผู้รับที่พร้อมส่งจริง โดยไม่โหลด recipient library ทั้งระบบ
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/line`}
        >
          จัดการ LINE
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Fact label="LINE OA" value={`${data.channels.length} ช่องทาง`} />
        <Fact
          label="พร้อมส่ง"
          value={`${data.readiness.send_ready_channels}/${data.readiness.total_channels}`}
        />
        <Fact label="ผู้รับทั้งหมด" value={`${data.targets.length} รายการ`} />
        <Fact
          label="ผู้รับพร้อมส่ง"
          value={`${data.readiness.ready_targets}/${data.readiness.total_targets}`}
        />
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-gray-50 p-2 dark:bg-white/[0.02]">
        {data.channels.slice(0, 4).map((channel) => (
          <div
            className="flex flex-col gap-2 rounded-lg bg-white p-3 dark:bg-white/[0.03] md:flex-row md:items-center md:justify-between"
            key={channel.id}
          >
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {channel.display_name}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {channel.scope === "owner_shared" ? "LINE OA กลาง" : "OA ร้าน"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge color={channel.channel_access_token_configured ? "success" : "warning"}>
                token {channel.channel_access_token_configured ? "พร้อม" : "ยังไม่ตั้ง"}
              </Badge>
              <Badge color={channel.channel_secret_configured ? "success" : "warning"}>
                secret {channel.channel_secret_configured ? "พร้อม" : "ยังไม่ตั้ง"}
              </Badge>
            </div>
          </div>
        ))}
        {!data.channels.length ? (
          <p className="rounded-lg p-3 text-sm text-gray-500 dark:text-gray-400">
            ยังไม่มี LINE OA ให้เพิ่มช่องทางหรือใช้ OA กลางก่อน
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PermissionStep({
  data,
  tenantId,
}: {
  data: OwnerV2PermissionSetupPayload;
  tenantId: string;
}) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            สิทธิ์รายงาน
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            role ของผู้รับต้องดูรายงานที่อยู่ในแผนแจ้งเตือนได้ก่อนเปิดใช้งานจริง
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/permissions`}
        >
          แก้สิทธิ์
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {data.roles.map((role) => (
          <Fact
            key={role.access_profile_key}
            label={role.label}
            value={`${role.target_count} ผู้รับ`}
          />
        ))}
      </div>
      {data.impacted_notification_plans.length ? (
        <InlineNotice
          message={`${data.impacted_notification_plans.length} แผนมีผู้รับที่สิทธิ์ไม่พอ ให้แก้สิทธิ์ก่อนเปิดรอบจริง`}
          title="มีสิทธิ์ที่ต้องแก้"
          tone="warning"
        />
      ) : (
        <InlineNotice
          message="ยังไม่พบแผนที่เปิดอยู่แล้วติดสิทธิ์ผู้รับ"
          title="สิทธิ์พร้อมสำหรับแผนปัจจุบัน"
          tone="success"
        />
      )}
    </div>
  );
}

function NotificationStep({
  data,
  tenantId,
}: {
  data: OwnerV2NotificationSetupPayload;
  tenantId: string;
}) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            แผนแจ้งเตือน
          </h3>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ตรวจแผนที่เปิดใช้งานและรอบล่าสุด โดยโหลดเฉพาะ tenant นี้
          </p>
        </div>
        <Link
          className={primaryActionClass}
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/notifications`}
        >
          ตั้งแผนแจ้งเตือน
        </Link>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Fact label="แผนทั้งหมด" value={`${data.rules.length} แผน`} />
        <Fact
          label="แผนเปิดใช้งาน"
          value={`${data.rules.filter((rule) => rule.enabled).length} แผน`}
        />
        <Fact
          label="ผู้รับพร้อมส่ง"
          value={`${data.enabled_target_count}/${data.target_count}`}
        />
      </div>
      <div className="flex flex-col gap-2 rounded-xl bg-gray-50 p-2 dark:bg-white/[0.02]">
        {data.rules.slice(0, 4).map((rule) => (
          <div
            className="flex flex-col gap-2 rounded-lg bg-white p-3 dark:bg-white/[0.03] md:flex-row md:items-center md:justify-between"
            key={rule.id}
          >
            <div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {rule.name}
              </p>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {rule.next_run
                  ? `รอบถัดไป ${rule.next_run.date} ${rule.next_run.time}`
                  : "ยังไม่มีรอบถัดไป"}
              </p>
            </div>
            <Badge color={rule.enabled ? "success" : "light"}>
              {rule.enabled ? "เปิดใช้งาน" : "ปิดอยู่"}
            </Badge>
          </div>
        ))}
        {!data.rules.length ? (
          <p className="rounded-lg p-3 text-sm text-gray-500 dark:text-gray-400">
            ยังไม่มีแผนแจ้งเตือน ตั้งแผนหลัง SML และ LINE พร้อม
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 break-words text-theme-sm font-semibold text-gray-800 dark:text-white/90">
        {value || "-"}
      </p>
    </div>
  );
}

function InlineNotice({
  message,
  title,
  tone,
}: {
  message: string;
  title: string;
  tone: "success" | "warning" | "error" | "info";
}) {
  const toneConfig = {
    error: {
      className:
        "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
      icon: <AlertIcon className="size-6 fill-current" />,
      iconClassName: "text-error-500",
    },
    info: {
      className:
        "border-blue-light-500 bg-blue-light-50 dark:border-blue-light-500/30 dark:bg-blue-light-500/15",
      icon: <InfoIcon className="size-6 fill-current" />,
      iconClassName: "text-blue-light-500 dark:text-blue-light-400",
    },
    success: {
      className:
        "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
      icon: <CheckCircleIcon className="size-6 fill-current" />,
      iconClassName: "text-success-500",
    },
    warning: {
      className:
        "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
      icon: <AlertIcon className="size-6 fill-current" />,
      iconClassName: "text-warning-500 dark:text-orange-400",
    },
  }[tone];

  return (
    <div className={`rounded-xl border p-4 ${toneConfig.className}`}>
      <div className="flex items-start gap-3">
        <div className={`-mt-0.5 shrink-0 ${toneConfig.iconClassName}`}>
          {toneConfig.icon}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </p>
          <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
            {message}
          </p>
        </div>
      </div>
    </div>
  );
}

function WorkbenchMessage({
  actionHref,
  actionLabel,
  message,
  onAction,
  title,
  tone,
}: {
  actionHref?: string;
  actionLabel: string;
  message: string;
  onAction?: () => void;
  title: string;
  tone: "warning" | "error" | "info";
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <InlineNotice message={message} title={title} tone={tone} />
      <div className="mt-4">
        {actionHref ? (
          <Link className={primaryActionClass} href={actionHref}>
            {actionLabel}
          </Link>
        ) : (
          <button
            className={primaryActionClass}
            onClick={onAction}
            type="button"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </section>
  );
}

function WorkbenchSkeleton() {
  return (
    <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
      <div className="h-[560px] animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="space-y-6">
        <div className="h-56 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
        <div className="h-80 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-5">
      <div className="h-5 w-48 animate-pulse rounded bg-gray-100 dark:bg-white/[0.06]" />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="h-20 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.06]" />
        <div className="h-20 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.06]" />
        <div className="h-20 animate-pulse rounded-2xl bg-gray-100 dark:bg-white/[0.06]" />
      </div>
      <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-white/[0.06]" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "active" || status === "trial"
      ? "success"
      : status === "past_due"
        ? "warning"
        : "error";
  return <Badge color={color}>{formatTenantStatus(status)}</Badge>;
}

function fallbackStep(step: OwnerV2StepId): OwnerV2SetupStep {
  return {
    key: step,
    ok: false,
    label: stepLabels[step],
    detail: "เลือกขั้นนี้เพื่อโหลดรายละเอียด",
    step,
    action_label: "ดูรายละเอียด",
    href: "",
  };
}

function detailEndpointForStep(tenantId: string, step: OwnerV2StepId) {
  const encodedTenantId = encodeURIComponent(tenantId);
  if (step === "sml" || step === "reports") {
    return step === "sml"
      ? `/api/owner/tenants/${encodedTenantId}/sml-setup`
      : `/api/owner/tenants/${encodedTenantId}/report-setup`;
  }
  if (step === "line") {
    return `/api/owner/tenants/${encodedTenantId}/line-setup`;
  }
  if (step === "permissions") {
    return `/api/owner/tenants/${encodedTenantId}/report-permissions`;
  }
  return `/api/owner/tenants/${encodedTenantId}/notification-setup`;
}

function parseStep(value: string | null): OwnerV2StepId {
  return value && stepOrder.includes(value as OwnerV2StepId)
    ? (value as OwnerV2StepId)
    : "store";
}

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function formatTenantStatus(status: string) {
  const labels: Record<string, string> = {
    trial: "ทดลองใช้",
    active: "ใช้งาน",
    past_due: "ค้างชำระ",
    suspended: "ระงับ",
    cancelled: "ยกเลิก",
  };
  return labels[status] ?? status;
}

function formatReportRunStatus(status: string) {
  const labels: Record<string, string> = {
    queued: "รอรัน",
    running: "กำลังรัน",
    success: "สำเร็จ",
    failed: "ล้มเหลว",
  };
  return labels[status] ?? status;
}

function formatWorkerStatus(status?: string | null) {
  if (!status) {
    return "ยังไม่ทราบ";
  }
  if (status === "ok") {
    return "ปกติ";
  }
  if (status === "missing") {
    return "ไม่พบ heartbeat";
  }
  return status;
}

function formatDatasourceSource(source: string) {
  if (source === "encrypted_store") {
    return "บันทึกใน system store";
  }
  if (source === "env") {
    return "อ่านจาก env";
  }
  return "ยังไม่ตั้ง";
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
