"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  reportKeyValues,
  type LineAccessProfileKey,
  type ReportKey,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { AlertIcon, InfoIcon, LockIcon } from "@/icons";
import {
  isAbortError,
  ownerV2Fetch,
  type OwnerV2FetchError,
} from "./api";
import OwnerV2StoreSetupNav from "./OwnerV2StoreSetupNav";
import type { OwnerV2PermissionSetupPayload } from "./types";
import {
  Fact,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  TechnicalDetails,
} from "./ui";

type PermissionSetupState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2PermissionSetupPayload };

type PermissionMatrix = Partial<Record<LineAccessProfileKey, ReportKey[]>>;

type PermissionImpact =
  OwnerV2PermissionSetupPayload["impacted_notification_plans"][number];

const emptyReports: OwnerV2PermissionSetupPayload["reports"] = [];
const emptyRoles: OwnerV2PermissionSetupPayload["roles"] = [];

export default function OwnerV2ReportPermissions({
  tenantId,
}: {
  tenantId: string;
}) {
  const [state, setState] = useState<PermissionSetupState>({
    status: "loading",
  });
  const [draft, setDraft] = useState<PermissionMatrix>({});
  const [initialDraft, setInitialDraft] = useState<PermissionMatrix>({});
  const [busy, setBusy] = useState<"save" | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [technicalMessage, setTechnicalMessage] = useState<string | null>(null);
  const [saveImpacts, setSaveImpacts] = useState<PermissionImpact[] | null>(
    null,
  );

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      setMessage(null);
      setTechnicalMessage(null);
      setSaveImpacts(null);
      try {
        const data = await ownerV2Fetch<OwnerV2PermissionSetupPayload>(
          `/api/owner/tenants/${encodeURIComponent(tenantId)}/report-permissions`,
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        const nextDraft = normalizePermissionMatrix(data);
        setState({ status: "success", data });
        setDraft(nextDraft);
        setInitialDraft(nextDraft);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดสิทธิ์รายงานไม่สำเร็จ",
        });
      }
    },
    [tenantId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const setup = state.status === "success" ? state.data : null;
  const reports = setup?.reports ?? emptyReports;
  const roles = setup?.roles ?? emptyRoles;
  const allReportKeys = useMemo(
    () => reports.map((report) => report.report_key),
    [reports],
  );
  const dirty = useMemo(
    () => !samePermissionMatrix(draft, initialDraft, roles),
    [draft, initialDraft, roles],
  );
  const delta = useMemo(
    () => countPermissionDelta(draft, initialDraft, roles),
    [draft, initialDraft, roles],
  );
  const totalTargets = roles.reduce((sum, role) => sum + role.target_count, 0);
  const enabledCellCount = roles.reduce(
    (sum, role) => sum + (draft[role.access_profile_key]?.length ?? 0),
    0,
  );
  const sensitiveAccessCount = reports
    .filter((report) => report.sensitive)
    .reduce(
      (sum, report) =>
        sum +
        roles.filter((role) =>
          draft[role.access_profile_key]?.includes(report.report_key),
        ).length,
      0,
    );
  const visibleImpacts =
    saveImpacts ?? setup?.impacted_notification_plans ?? [];
  const saveDisabled = busy !== null || state.status !== "success" || !dirty;

  function togglePermission(
    profileKey: LineAccessProfileKey,
    reportKey: ReportKey,
  ) {
    if (busy) {
      return;
    }
    setDraft((current) => {
      const selected = new Set(current[profileKey] ?? []);
      if (selected.has(reportKey)) {
        selected.delete(reportKey);
      } else {
        selected.add(reportKey);
      }

      return {
        ...current,
        [profileKey]: allReportKeys.filter((key) => selected.has(key)),
      };
    });
    setMessage(null);
    setTechnicalMessage(null);
    setSaveImpacts(null);
  }

  function setRoleReports(profileKey: LineAccessProfileKey, next: ReportKey[]) {
    if (busy) {
      return;
    }
    setDraft((current) => ({
      ...current,
      [profileKey]: uniqueReportKeys(next),
    }));
    setMessage(null);
    setTechnicalMessage(null);
    setSaveImpacts(null);
  }

  async function savePermissions() {
    if (!setup || saveDisabled) {
      setMessage({
        tone: "warning",
        text: dirty
          ? "กำลังบันทึกอยู่ กรุณารอสถานะล่าสุดก่อนกดซ้ำ"
          : "ยังไม่มีการเปลี่ยนแปลงให้บันทึก",
      });
      return;
    }

    setBusy("save");
    setMessage(null);
    setSaveImpacts(null);
    try {
      const data = await ownerV2Fetch<OwnerV2PermissionSetupPayload>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/report-permissions`,
        {
          method: "PUT",
          body: {
            permissions: roles.map((role) => ({
              access_profile_key: role.access_profile_key,
              allowed_report_keys: draft[role.access_profile_key] ?? [],
            })),
          },
        },
      );
      const nextDraft = normalizePermissionMatrix(data);
      setState({ status: "success", data });
      setDraft(nextDraft);
      setInitialDraft(nextDraft);
      setMessage({
        tone: "success",
        text: `บันทึกสิทธิ์แล้ว และปรับผู้รับ LINE ${data.updated_line_targets ?? 0} ราย`,
      });
    } catch (error) {
      const payload = (error as OwnerV2FetchError).payload;
      const impacts = readPermissionImpacts(payload?.impacted_notification_plans);
      if (impacts.length) {
        setSaveImpacts(impacts);
      }
      setTechnicalMessage(error instanceof Error ? error.message : "ไม่พบรายละเอียด");
      setMessage({
        tone: "error",
        text:
          impacts.length > 0
            ? "บันทึกไม่ได้ เพราะแผนแจ้งเตือนที่เปิดอยู่จะส่งรายงานให้ผู้รับที่ไม่มีสิทธิ์ กรุณาแก้ผู้รับ LINE หรือแผนแจ้งเตือนก่อน"
            : "บันทึกสิทธิ์รายงานไม่สำเร็จ ลองโหลดข้อมูลใหม่แล้วตรวจสิทธิ์ของผู้รับอีกครั้ง",
      });
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-5 sm:space-y-6">
        <OwnerV2StoreSetupNav current="permissions" tenantId={tenantId} />
        <PermissionsSkeleton />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-5 sm:space-y-6">
        <OwnerV2StoreSetupNav current="permissions" tenantId={tenantId} />
        <Panel>
          <PanelBody spaced>
            <EmptyState
              action={
                <Button
                  onClick={() => void load()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  โหลดใหม่
                </Button>
              }
              detail="ลองโหลดใหม่อีกครั้ง ถ้ายังไม่สำเร็จ ให้เปิดศูนย์ตรวจระบบหรือเลือกร้านใหม่"
              title="โหลดสิทธิ์รายงานไม่สำเร็จ"
            />
            <TechnicalDetails embedded title="รายละเอียดข้อผิดพลาด">
              <Fact label="ข้อความระบบ" value={state.message} />
            </TechnicalDetails>
          </PanelBody>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <OwnerV2StoreSetupNav current="permissions" tenantId={tenantId} />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel>
          <PanelHeader
            action={
              <div className="flex flex-wrap gap-2">
                <Badge color={dirty ? "warning" : "success"}>
                  {dirty ? "ยังไม่ได้บันทึก" : "ข้อมูลล่าสุด"}
                </Badge>
                <Badge color="light">{reports.length} รายงาน</Badge>
                <Badge color="light">{roles.length} กลุ่มสิทธิ์</Badge>
              </div>
            }
            description="กำหนดว่าผู้รับแต่ละกลุ่มเปิดดูรายงานใดได้บ้าง สิทธิ์นี้ใช้กับ LINE และหน้าดูรายงานของร้านนี้"
            title="สิทธิ์ดูรายงาน"
          />
          <PanelBody spaced>
            {message ? (
              <Notice tone={message.tone} title={message.text} />
            ) : null}
            {technicalMessage ? (
              <TechnicalDetails embedded title="รายละเอียดข้อผิดพลาด">
                <Fact label="ข้อความระบบ" value={technicalMessage} />
              </TechnicalDetails>
            ) : null}

            {visibleImpacts.length ? (
              <ImpactNotice impacts={visibleImpacts} tenantId={tenantId} />
            ) : null}

            <div className="hidden overflow-hidden rounded-lg bg-gray-50 px-4 pb-3 pt-4 dark:bg-white/[0.02] sm:px-5 lg:block">
              <div className="w-full overflow-x-auto">
                <table className="w-full min-w-[760px]">
                  <thead>
                    <tr className="border-y border-gray-100 dark:border-gray-800">
                      <th className="w-[34%] py-3 pr-5 text-left sm:pr-6">
                        <p className="font-medium text-gray-500 text-theme-xs dark:text-gray-400">
                          รายงาน
                        </p>
                      </th>
                      {roles.map((role) => (
                        <th
                          className="min-w-[9.5rem] px-3 py-3 text-center"
                          key={role.access_profile_key}
                        >
                          <span className="block font-medium text-gray-500 text-theme-xs dark:text-gray-400">
                            {role.label}
                          </span>
                          <span className="mt-1 block text-theme-xs font-normal text-gray-400 dark:text-gray-500">
                            {role.target_count} ผู้รับ
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {reports.map((report) => (
                      <tr key={report.report_key}>
                        <td className="py-4 pr-5 align-top sm:pr-6">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                              {report.label}
                            </span>
                            {report.sensitive ? (
                              <Badge color="warning" size="sm">
                                ข้อมูลอ่อนไหว
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 max-w-[62ch] text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
                            {report.description}
                          </p>
                        </td>
                        {roles.map((role) => {
                          const checked = Boolean(
                            draft[role.access_profile_key]?.includes(
                              report.report_key,
                            ),
                          );
                          return (
                            <td
                              className="px-3 py-4 text-center align-top"
                              key={role.access_profile_key}
                            >
                              <label className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-gray-200 bg-white transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-white/[0.03]">
                                <span className="sr-only">
                                  {role.label}: {report.label}
                                </span>
                                <input
                                  checked={checked}
                                  className="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                                  disabled={busy !== null}
                                  onChange={() =>
                                    togglePermission(
                                      role.access_profile_key,
                                      report.report_key,
                                    )
                                  }
                                  type="checkbox"
                                />
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-3 lg:hidden">
              {reports.map((report) => (
                <div
                  className="rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]"
                  key={report.report_key}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">
                      {report.label}
                    </p>
                    {report.sensitive ? (
                      <Badge color="warning" size="sm">
                        ข้อมูลอ่อนไหว
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {report.description}
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {roles.map((role) => {
                      const checked = Boolean(
                        draft[role.access_profile_key]?.includes(
                          report.report_key,
                        ),
                      );
                      return (
                        <label
                          className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm transition hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-white/[0.03]"
                          key={role.access_profile_key}
                        >
                          <span className="min-w-0">
                            <span className="block font-medium text-gray-800 dark:text-white/90">
                              {role.label}
                            </span>
                            <span className="block text-xs text-gray-500 dark:text-gray-400">
                              {role.target_count} ผู้รับ
                            </span>
                          </span>
                          <input
                            checked={checked}
                            className="h-5 w-5 shrink-0 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                            disabled={busy !== null}
                            onChange={() =>
                              togglePermission(
                                role.access_profile_key,
                                report.report_key,
                              )
                            }
                            type="checkbox"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </PanelBody>
        </Panel>

      <div className="space-y-6">
        <Panel>
          <PanelHeader
            description="บันทึกแล้วระบบจะปรับสิทธิ์ผู้รับ LINE ของร้านนี้เท่านั้น"
            title={state.data.tenant.name}
          />
          <PanelBody spaced>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="ผู้รับ LINE" value={totalTargets.toString()} />
              <Metric label="สิทธิ์ที่เปิด" value={enabledCellCount.toString()} />
              <Metric label="เพิ่มใหม่" value={delta.added.toString()} />
              <Metric label="ปิดออก" value={delta.removed.toString()} />
            </div>

            <div className="mt-4 rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400">
                  <LockIcon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    สิทธิ์ข้อมูลอ่อนไหว
                  </p>
                  <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                    เปิดข้อมูลต้นทุนหรือยอดลูกหนี้อยู่ {sensitiveAccessCount} จุด
                    ควรตรวจกลุ่มที่ไม่ใช่ผู้บริหารก่อนบันทึก
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-col gap-3">
              <Button
                disabled={saveDisabled}
                onClick={() => void savePermissions()}
                type="button"
              >
                {busy === "save" ? "กำลังบันทึก..." : "ตรวจผลกระทบและบันทึก"}
              </Button>
              <Button
                disabled={!dirty || busy !== null}
                onClick={() => {
                  setDraft(initialDraft);
                  setMessage({
                    tone: "warning",
                    text: "ยกเลิกการเปลี่ยนแปลงบนหน้าจอแล้ว ยังไม่ได้บันทึกอะไร",
                  });
                  setTechnicalMessage(null);
                  setSaveImpacts(null);
                }}
                type="button"
                variant="outline"
              >
                ย้อนกลับค่าเดิม
              </Button>
              <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">
                {saveDisabled
                  ? dirty
                    ? "กำลังทำงาน กรุณารอสถานะล่าสุดก่อน"
                    : "ยังไม่มีการเปลี่ยนแปลงให้บันทึก"
                  : "พร้อมบันทึก ระบบจะตรวจแผนแจ้งเตือนที่เปิดอยู่ก่อนเสมอ"}
              </p>
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            description="ใช้เมื่อเริ่มตั้งร้านใหม่หรือแก้หลายกลุ่มในครั้งเดียว"
            title="ตั้งเร็วตามกลุ่มผู้รับ"
          />
          <PanelBody spaced>
            <div className="space-y-3">
              {roles.map((role) => (
                <RoleShortcut
                  allReportKeys={allReportKeys}
                  currentCount={draft[role.access_profile_key]?.length ?? 0}
                  disabled={busy !== null}
                  key={role.access_profile_key}
                  onSetRoleReports={(next) =>
                    setRoleReports(role.access_profile_key, next)
                  }
                  role={role}
                />
              ))}
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="ทางลัดแก้ปัญหา" />
          <PanelBody spaced>
            <div className="grid gap-3">
              <ActionLink
                href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/line`}
                icon={<InfoIcon className="h-4 w-4" />}
                text="แก้กลุ่มสิทธิ์หรือสถานะของผู้รับ LINE"
                title="ผู้รับ LINE"
              />
              <ActionLink
                href={`/owner-v2/stores/${encodeURIComponent(
                  tenantId,
                )}/notifications`}
                icon={<AlertIcon className="h-4 w-4" />}
                text="แก้แผนแจ้งเตือนที่ยังอ้างถึงรายงานเดิม"
                title="แผนแจ้งเตือน"
              />
            </div>
          </PanelBody>
        </Panel>
      </div>
    </div>
    </div>
  );
}

function ImpactNotice({
  impacts,
  tenantId,
}: {
  impacts: PermissionImpact[];
  tenantId: string;
}) {
  return (
    <div className="rounded-xl border border-warning-500 bg-warning-50 p-4 dark:border-warning-500/30 dark:bg-warning-500/15">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <AlertIcon className="h-5 w-5 text-warning-600 dark:text-warning-400" />
            <p className="text-sm font-semibold text-warning-800 dark:text-warning-200">
              ต้องแก้แผนแจ้งเตือนก่อนบันทึก
            </p>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-warning-700 dark:text-warning-300">
            มีแผนที่เปิดใช้งานอยู่และผู้รับจะไม่มีสิทธิ์เปิดรายงาน กรุณาแก้ผู้รับ
            LINE หรือแผนแจ้งเตือนก่อนลองบันทึกอีกครั้ง
          </p>
        </div>
        <Link
          className="inline-flex w-full items-center justify-center rounded-lg border border-warning-300 bg-white px-4 py-2.5 text-sm font-medium text-warning-700 shadow-theme-xs transition hover:bg-warning-50 hover:text-warning-800 dark:border-warning-500/40 dark:bg-transparent dark:text-warning-200 sm:w-auto"
          href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/notifications`}
        >
          ไปแก้แผนแจ้งเตือน
        </Link>
      </div>
      <div className="mt-3 grid gap-2">
        {impacts.slice(0, 5).map((impact) => (
          <div
            className="rounded-lg bg-white px-3 py-2 text-sm leading-6 text-gray-700 dark:bg-gray-900 dark:text-gray-300"
            key={`${impact.rule_id}:${impact.target_id}:${impact.report_key}`}
          >
            <span className="font-semibold text-gray-900 dark:text-white">
              {impact.rule_name}
            </span>
            <span> ส่ง {impact.report_label} ให้ </span>
            <span className="font-medium">{impact.target_display_name}</span>
          </div>
        ))}
        {impacts.length > 5 ? (
          <p className="text-xs text-warning-700 dark:text-warning-300">
            และอีก {impacts.length - 5} รายการ
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function RoleShortcut({
  allReportKeys,
  currentCount,
  disabled,
  onSetRoleReports,
  role,
}: {
  allReportKeys: ReportKey[];
  currentCount: number;
  disabled: boolean;
  onSetRoleReports: (next: ReportKey[]) => void;
  role: OwnerV2PermissionSetupPayload["roles"][number];
}) {
  const basicReportKeys = allReportKeys.filter(
    (key) =>
      key === "sales_goods_services" ||
      key === "purchase_goods_payables" ||
      key === "stock_reorder",
  );
  return (
    <div className="rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {role.label}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            เปิดอยู่ {currentCount}/{allReportKeys.length} รายงาน,{" "}
            {role.target_count} ผู้รับ
          </p>
        </div>
        <Badge color={role.target_count ? "info" : "light"} size="sm">
          {role.target_count} ผู้รับ
        </Badge>
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <button
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200"
          disabled={disabled}
          onClick={() => onSetRoleReports(allReportKeys)}
          type="button"
        >
          เปิดทั้งหมด
        </button>
        <button
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200"
          disabled={disabled}
          onClick={() => onSetRoleReports(basicReportKeys)}
          type="button"
        >
          เปิดเฉพาะพื้นฐาน
        </button>
        <button
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-theme-xs transition hover:bg-gray-50 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-white/[0.03] dark:hover:text-gray-200"
          disabled={disabled}
          onClick={() => onSetRoleReports([])}
          type="button"
        >
          ปิดทั้งหมด
        </button>
      </div>
    </div>
  );
}

function ActionLink({
  href,
  icon,
  text,
  title,
}: {
  href: string;
  icon: ReactNode;
  text: string;
  title: string;
}) {
  return (
    <Link
      className="flex items-start gap-3 rounded-lg bg-gray-50 p-4 transition hover:bg-brand-50 dark:bg-white/[0.02] dark:hover:bg-brand-500/10"
      href={href}
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-brand-600 dark:bg-gray-900 dark:text-brand-400">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold text-gray-900 dark:text-white">
          {title}
        </span>
        <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
          {text}
        </span>
      </span>
    </Link>
  );
}

function EmptyState({
  action,
  detail,
  title,
}: {
  action?: ReactNode;
  detail: string;
  title: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02] sm:p-6">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-500 dark:bg-gray-900 dark:text-gray-400">
        <InfoIcon className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-gray-900 dark:text-white">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
        {detail}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

function PermissionsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel>
        <PanelHeader title="กำลังโหลดสิทธิ์รายงาน" />
        <PanelBody spaced>
          <MiniSkeleton rows={6} />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="กำลังโหลดสถานะ" />
        <PanelBody spaced>
          <MiniSkeleton rows={4} />
        </PanelBody>
      </Panel>
    </div>
  );
}

function MiniSkeleton({ rows }: { rows: number }) {
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          className="h-11 rounded-lg bg-gray-100 dark:bg-gray-800"
          key={index}
        />
      ))}
    </div>
  );
}

function normalizePermissionMatrix(
  data: OwnerV2PermissionSetupPayload,
): PermissionMatrix {
  // Guard every slice against null: a freshly-created or unconfigured tenant
  // can return explicit null for reports/roles/matrix/permissions, and the old
  // unguarded .map/.find/index calls would throw inside load() and leave the
  // page stuck on the skeleton.
  const reports = data.reports ?? [];
  const roles = data.roles ?? [];
  const matrix = data.matrix ?? {};
  const permissions = data.permissions ?? [];
  const validReportKeys = new Set(reports.map((report) => report.report_key));
  return Object.fromEntries(
    roles.map((role) => {
      const matrixReports = matrix[role.access_profile_key] ?? [];
      const recordReports =
        permissions.find(
          (permission) =>
            permission.access_profile_key === role.access_profile_key,
        )?.allowed_report_keys ?? [];
      const allowed = uniqueReportKeys(
        (matrixReports.length ? matrixReports : recordReports).filter((key) =>
          validReportKeys.has(key),
        ),
      );
      return [role.access_profile_key, allowed];
    }),
  ) as PermissionMatrix;
}

function samePermissionMatrix(
  left: PermissionMatrix,
  right: PermissionMatrix,
  roles: OwnerV2PermissionSetupPayload["roles"],
) {
  return roles.every((role) =>
    sameReportKeys(
      left[role.access_profile_key] ?? [],
      right[role.access_profile_key] ?? [],
    ),
  );
}

function sameReportKeys(left: ReportKey[], right: ReportKey[]) {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((key) => rightSet.has(key));
}

function countPermissionDelta(
  draft: PermissionMatrix,
  initial: PermissionMatrix,
  roles: OwnerV2PermissionSetupPayload["roles"],
) {
  let added = 0;
  let removed = 0;
  for (const role of roles) {
    const profileKey = role.access_profile_key;
    const nextSet = new Set(draft[profileKey] ?? []);
    const previousSet = new Set(initial[profileKey] ?? []);
    for (const key of nextSet) {
      if (!previousSet.has(key)) {
        added += 1;
      }
    }
    for (const key of previousSet) {
      if (!nextSet.has(key)) {
        removed += 1;
      }
    }
  }
  return { added, removed };
}

function uniqueReportKeys(values: ReportKey[]) {
  const validKeys = new Set<ReportKey>(reportKeyValues);
  const selected = new Set(values.filter((value) => validKeys.has(value)));
  return reportKeyValues.filter((key) => selected.has(key));
}

function readPermissionImpacts(value: unknown): PermissionImpact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isPermissionImpact);
}

function isPermissionImpact(value: unknown): value is PermissionImpact {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.rule_id === "string" &&
    typeof record.rule_name === "string" &&
    typeof record.target_id === "string" &&
    typeof record.target_display_name === "string" &&
    typeof record.report_key === "string" &&
    typeof record.report_label === "string"
  );
}
