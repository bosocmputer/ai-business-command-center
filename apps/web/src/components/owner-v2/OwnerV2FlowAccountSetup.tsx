"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { isAbortError, ownerV2Fetch, type OwnerV2FetchError } from "./api";
import type {
  OwnerV2FlowAccountConfigStatus,
  OwnerV2FlowAccountTestResult,
} from "./types";
import {
  Fact,
  Field,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  TechnicalDetails,
  formatDateTime,
  secondaryActionClass,
} from "./ui";

type FlowAccountState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2FlowAccountConfigStatus };

type MessageState = {
  tone: "success" | "warning" | "error" | "info";
  text: string;
};

export default function OwnerV2FlowAccountSetup({
  tenantId,
}: {
  tenantId: string;
}) {
  const [state, setState] = useState<FlowAccountState>({
    status: "loading",
  });
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [message, setMessage] = useState<MessageState | null>(null);
  const [technicalMessage, setTechnicalMessage] = useState<string | null>(null);
  const [testResult, setTestResult] =
    useState<OwnerV2FlowAccountTestResult | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      setTechnicalMessage(null);
      try {
        const data = await ownerV2Fetch<OwnerV2FlowAccountConfigStatus>(
          `/api/owner/tenants/${encodeURIComponent(tenantId)}/flowaccount/config`,
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        setTechnicalMessage(null);
        setState({ status: "success", data });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setTechnicalMessage(technicalErrorMessage(error));
        setState({
          status: "error",
          message:
            "โหลดสถานะ FlowAccount ไม่สำเร็จ กรุณารีเฟรชหน้า หรือตรวจสิทธิ์ผู้ดูแลแล้วลองใหม่",
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

  const statusData = state.status === "success" ? state.data : null;
  const canSave = clientId.trim().length > 0 && clientSecret.trim().length > 0;
  const statusTone = useMemo(
    () => flowAccountStatusTone(statusData?.status),
    [statusData?.status],
  );

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy !== null) {
      return;
    }
    if (!canSave) {
      setMessage({
        tone: "warning",
        text: "กรอกรหัสเชื่อมต่อและรหัสลับให้ครบก่อนบันทึก",
      });
      return;
    }

    setBusy("save");
    setMessage(null);
    setTechnicalMessage(null);
    setTestResult(null);
    try {
      const data = await ownerV2Fetch<OwnerV2FlowAccountConfigStatus>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/flowaccount/config`,
        {
          method: "PUT",
          body: {
            environment: "sandbox",
            auth_mode: "client_credentials",
            client_id: clientId.trim(),
            client_secret: clientSecret,
          },
        },
      );
      setClientId("");
      setClientSecret("");
      setState({ status: "success", data });
      setMessage({
        tone: "success",
        text: "บันทึกข้อมูลเชื่อมต่อแบบทดสอบแล้ว ยังต้องกดทดสอบก่อนนำผลไปใช้",
      });
      setTechnicalMessage(null);
    } catch (error) {
      setTechnicalMessage(technicalErrorMessage(error));
      setMessage({
        tone: "error",
        text:
          "บันทึกข้อมูลเชื่อมต่อ FlowAccount ไม่สำเร็จ กรุณาตรวจรหัสเชื่อมต่อ รหัสลับ และสิทธิ์ผู้ดูแลก่อนลองใหม่",
      });
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    if (busy !== null) {
      return;
    }
    if (!statusData?.credentials_configured) {
      setMessage({
        tone: "warning",
        text: "บันทึกข้อมูลเชื่อมต่อก่อนทดสอบระบบ",
      });
      return;
    }

    setBusy("test");
    setMessage(null);
    setTechnicalMessage(null);
    setTestResult(null);
    try {
      const data = await ownerV2Fetch<OwnerV2FlowAccountTestResult>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/flowaccount/test`,
        { method: "POST" },
      );
      setTestResult(data);
      setMessage({
        tone: "success",
        text: "ทดสอบ FlowAccount สำเร็จและอัปเดตข้อมูลล่าสุดแล้ว",
      });
      setTechnicalMessage(null);
      await load();
    } catch (error) {
      const providerResult = flowAccountErrorResult(error);
      if (providerResult) {
        setTestResult(providerResult);
      }
      const technical = technicalErrorMessage(error);
      setTechnicalMessage(technical);
      setMessage({
        tone: "error",
        text:
          providerResult?.safe_error_message ??
          "ทดสอบ FlowAccount ไม่สำเร็จ กรุณาตรวจข้อมูลเชื่อมต่อและลองใหม่",
      });
      await load().catch(() => null);
      setTechnicalMessage(technical);
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return <FlowAccountSkeleton />;
  }

  if (state.status === "error") {
    return (
      <Panel>
        <PanelBody>
          <Notice
            tone="error"
            title="โหลด FlowAccount ไม่สำเร็จ"
            text={state.message}
          />
          {technicalMessage ? (
            <div className="mt-4">
              <TechnicalDetails embedded title="รายละเอียดข้อผิดพลาด">
                <Fact label="ข้อความระบบ" value={technicalMessage} />
              </TechnicalDetails>
            </div>
          ) : null}
          <Button
            className="mt-4 w-full sm:w-auto"
            onClick={() => void load()}
            type="button"
          >
            รีเฟรชสถานะ
          </Button>
        </PanelBody>
      </Panel>
    );
  }

  const data = state.data;

  return (
    <div className="space-y-5 sm:space-y-6">
      <Panel>
        <PanelHeader
          title="ทดสอบเชื่อมต่อ FlowAccount"
          description="ใช้สำหรับตรวจข้อมูลเชื่อมต่อแบบทดสอบเท่านั้น ระบบจะไม่แสดงค่าลับที่บันทึกไว้"
          action={
            <Link
              className={secondaryActionClass}
              href={`/owner-v2/stores/${encodeURIComponent(tenantId)}?tab=system`}
            >
              กลับสถานะร้าน
            </Link>
          }
        />
        <PanelBody spaced>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Fact label="สภาพแวดล้อม" tone="light" value="ทดสอบ" />
            <Fact label="วิธีเชื่อมต่อ" tone="light" value="รหัสเชื่อมต่อ" />
            <Fact
              label="ข้อมูลเชื่อมต่อ"
              tone={data.credentials_configured ? "success" : "warning"}
              value={data.credentials_configured ? "บันทึกแล้ว" : "ยังไม่มี"}
            />
            <Fact
              label="การเข้ารหัส"
              tone={data.encryption_configured ? "success" : "error"}
              value={data.encryption_configured ? "พร้อม" : "ยังไม่พร้อม"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
                    ข้อมูลล่าสุดที่ปลอดภัย
                  </h4>
                  <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                    แสดงเฉพาะค่าที่ใช้ตรวจระบบได้ โดยไม่เปิดเผยรหัสลับ
                  </p>
                </div>
                <Badge color={statusTone}>{flowAccountStatusLabel(data.status)}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fact label="รหัสบริษัท" value={data.company_id ?? "-"} />
                <Fact label="รหัสช่วยตรวจ" value={data.support_code ?? "-"} />
                <Fact
                  label="สิทธิ์เชื่อมต่อหมดอายุ"
                  value={formatDateTime(data.access_token_expires_at)}
                />
                <Fact label="ทดสอบล่าสุด" value={formatDateTime(data.last_tested_at)} />
                <Fact label="อัปเดตล่าสุด" value={formatDateTime(data.updated_at)} />
                <Fact
                  label="ข้อผิดพลาดล่าสุด"
                  tone={data.last_error ? "warning" : "success"}
                  value={data.last_error ? "มีข้อควรตรวจ" : "ไม่มี"}
                />
              </div>
              {data.last_error ? (
                <div className="mt-4">
                  <TechnicalDetails
                    embedded
                    title="รายละเอียดเทคนิคของข้อผิดพลาด"
                    description="เปิดดูเมื่อต้องส่งข้อมูลให้ทีมดูแลระบบหรือเทียบกับบันทึกจาก FlowAccount"
                  >
                    <p className="break-words text-sm leading-6 text-gray-500 dark:text-gray-400">
                      {data.last_error}
                    </p>
                  </TechnicalDetails>
                </div>
              ) : null}
            </section>

            <form
              className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
              onSubmit={saveConfig}
            >
              <div className="mb-4">
                <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
                  ข้อมูลเชื่อมต่อ
                </h4>
                <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                  ช่องรหัสลับจะถูกล้างหลังบันทึก และไม่แสดงค่าที่เคยบันทึกไว้
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Field label="สภาพแวดล้อม">
                  <input
                    className="owner-v2-input"
                    disabled
                    readOnly
                    type="text"
                    value="ทดสอบ"
                  />
                </Field>
                <Field label="วิธีเชื่อมต่อ">
                  <input
                    className="owner-v2-input"
                    disabled
                    readOnly
                    type="text"
                    value="รหัสเชื่อมต่อ"
                  />
                </Field>
                <Field
                  label="รหัสเชื่อมต่อ"
                  help={data.credentials_configured ? "กรอกเฉพาะเมื่อต้องการแทนที่ค่าเดิม" : undefined}
                >
                  <input
                    autoComplete="off"
                    className="owner-v2-input"
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="รหัสเชื่อมต่อ FlowAccount"
                    type="text"
                    value={clientId}
                  />
                </Field>
                <Field
                  label="รหัสลับ"
                  help={data.credentials_configured ? "ไม่แสดงค่าที่บันทึกไว้" : undefined}
                >
                  <input
                    autoComplete="new-password"
                    className="owner-v2-input"
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder="รหัสลับ FlowAccount"
                    type="password"
                    value={clientSecret}
                  />
                </Field>
              </div>

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Button
                  disabled={busy !== null || !canSave}
                  size="sm"
                  type="submit"
                >
                  {busy === "save" ? "กำลังบันทึก..." : "บันทึกข้อมูลเชื่อมต่อ"}
                </Button>
                <Button
                  disabled={busy !== null || !data.credentials_configured}
                  onClick={() => void testConnection()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "test" ? "กำลังทดสอบ..." : "ทดสอบการเชื่อมต่อ"}
                </Button>
              </div>
            </form>
          </div>
        </PanelBody>
      </Panel>

      {message ? (
        <Notice tone={message.tone} title="สถานะ FlowAccount" text={message.text} />
      ) : null}
      {technicalMessage ? (
        <TechnicalDetails embedded title="รายละเอียดการทำรายการ">
          <Fact label="ข้อความระบบ" value={technicalMessage} />
        </TechnicalDetails>
      ) : null}

      {testResult ? <FlowAccountTestResult result={testResult} /> : null}
    </div>
  );
}

function FlowAccountTestResult({
  result,
}: {
  result: OwnerV2FlowAccountTestResult;
}) {
  return (
    <Panel>
      <PanelHeader
        title="ผลทดสอบล่าสุด"
        description="แสดงเฉพาะผลตรวจที่ปลอดภัย ไม่แสดงค่าลับหรือข้อมูลดิบจากผู้ให้บริการ"
        action={
          <Badge color={result.ok ? "success" : "error"}>
            {result.ok ? "ผ่าน" : "ไม่ผ่าน"}
          </Badge>
        }
      />
      <PanelBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="ตรวจเมื่อ" value={formatDateTime(result.checked_at)} />
          <Fact
            label="ผลทดสอบ"
            tone={result.ok ? "success" : "error"}
            value={result.ok ? "เชื่อมต่อได้" : "ควรตรวจ"}
          />
          <Fact label="รหัสบริษัท" value={result.company_id ?? "-"} />
          <Fact label="รหัสช่วยตรวจ" value={result.support_code ?? "-"} />
        </div>
        {result.safe_error_message ? (
          <div className="mt-4">
            <Notice
              tone="warning"
              title="ข้อผิดพลาดที่ตรวจได้"
              text={result.safe_error_message}
            />
          </div>
        ) : null}
        <div className="mt-4">
          <TechnicalDetails
            embedded
            title="รายละเอียดเทคนิคของการทดสอบ FlowAccount"
            description="เปิดดูเมื่อต้องตรวจเวลาเชื่อมต่อหรือสถานะจากผู้ให้บริการ"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fact
                label="เวลาเชื่อมต่อ"
                value={formatFlowAccountLatency(result.latency_ms)}
              />
              <Fact
                label="สถานะผู้ให้บริการ"
                value={result.provider_status?.toString() ?? "-"}
              />
            </div>
          </TechnicalDetails>
        </div>
      </PanelBody>
    </Panel>
  );
}

function FlowAccountSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="h-64 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="h-48 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}

function flowAccountStatusLabel(status: OwnerV2FlowAccountConfigStatus["status"]) {
  const labels: Record<OwnerV2FlowAccountConfigStatus["status"], string> = {
    missing: "ยังไม่มี",
    configured_untested: "รอทดสอบ",
    connected: "เชื่อมต่อแล้ว",
    error: "มีปัญหา",
  };
  return labels[status];
}

function flowAccountStatusTone(
  status?: OwnerV2FlowAccountConfigStatus["status"],
) {
  if (status === "connected") {
    return "success" as const;
  }
  if (status === "error") {
    return "error" as const;
  }
  return "warning" as const;
}

function flowAccountErrorResult(
  error: unknown,
): OwnerV2FlowAccountTestResult | null {
  const payload = (error as OwnerV2FetchError | undefined)?.payload;
  const data = payload?.data;
  if (!data || typeof data !== "object") {
    return null;
  }
  const maybeResult = data as Partial<OwnerV2FlowAccountTestResult>;
  if (typeof maybeResult.ok !== "boolean") {
    return null;
  }
  return maybeResult as OwnerV2FlowAccountTestResult;
}

function formatFlowAccountLatency(value: number) {
  if (value < 1000) {
    return "น้อยกว่า 1 วินาที";
  }
  const seconds = Math.round(value / 1000);
  if (seconds < 60) {
    return `${seconds} วินาที`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes} นาที ${seconds % 60} วินาที`;
}

function technicalErrorMessage(error: unknown) {
  const fetchError = error as OwnerV2FetchError | undefined;
  const payload = fetchError?.payload;
  const payloadError =
    typeof payload?.error === "string" && payload.error.trim()
      ? payload.error.trim()
      : null;
  const fallback = error instanceof Error ? error.message : "ไม่พบรายละเอียด";
  const message = payloadError ?? fallback;
  return fetchError?.status ? `HTTP ${fetchError.status}: ${message}` : message;
}
