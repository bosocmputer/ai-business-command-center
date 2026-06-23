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
  const [testResult, setTestResult] =
    useState<OwnerV2FlowAccountTestResult | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const data = await ownerV2Fetch<OwnerV2FlowAccountConfigStatus>(
          `/api/owner/tenants/${encodeURIComponent(tenantId)}/flowaccount/config`,
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        setState({ status: "success", data });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดสถานะ FlowAccount ไม่สำเร็จ",
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
        text: "กรอก client id และ client secret ให้ครบก่อนบันทึก",
      });
      return;
    }

    setBusy("save");
    setMessage(null);
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
        text: "บันทึก FlowAccount sandbox credentials แล้ว ยังต้องกดทดสอบก่อนนำผลไปใช้",
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "บันทึก FlowAccount credentials ไม่สำเร็จ",
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
        text: "บันทึก client credentials ก่อนทดสอบ sandbox API",
      });
      return;
    }

    setBusy("test");
    setMessage(null);
    setTestResult(null);
    try {
      const data = await ownerV2Fetch<OwnerV2FlowAccountTestResult>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/flowaccount/test`,
        { method: "POST" },
      );
      setTestResult(data);
      setMessage({
        tone: "success",
        text: "ทดสอบ FlowAccount sandbox สำเร็จและอัปเดต metadata แล้ว",
      });
      await load();
    } catch (error) {
      const providerResult = flowAccountErrorResult(error);
      if (providerResult) {
        setTestResult(providerResult);
      }
      setMessage({
        tone: "error",
        text:
          providerResult?.safe_error_message ??
          (error instanceof Error
            ? error.message
            : "ทดสอบ FlowAccount sandbox ไม่สำเร็จ"),
      });
      await load().catch(() => null);
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
            text={`${state.message} ตรวจ AI_BCC_SECRET_KEY, API session และ tenant ก่อนลองใหม่`}
          />
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
          title="FlowAccount Sandbox"
          description="Client Credentials สำหรับทดสอบ OpenAPI sandbox เท่านั้น"
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
            <Fact label="Environment" tone="light" value="Sandbox" />
            <Fact label="Auth mode" tone="light" value="Client Credentials" />
            <Fact
              label="Credentials"
              tone={data.credentials_configured ? "success" : "warning"}
              value={data.credentials_configured ? "บันทึกแล้ว" : "ยังไม่มี"}
            />
            <Fact
              label="Encryption"
              tone={data.encryption_configured ? "success" : "error"}
              value={data.encryption_configured ? "พร้อม" : "ยังไม่พร้อม"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
                    Metadata ล่าสุด
                  </h4>
                  <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                    แสดงเฉพาะค่าที่ปลอดภัยจาก backend
                  </p>
                </div>
                <Badge color={statusTone}>{flowAccountStatusLabel(data.status)}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fact label="Company ID" value={data.company_id ?? "-"} />
                <Fact label="Support code" value={data.support_code ?? "-"} />
                <Fact
                  label="Token expires"
                  value={formatDateTime(data.access_token_expires_at)}
                />
                <Fact label="Last tested" value={formatDateTime(data.last_tested_at)} />
                <Fact label="Updated" value={formatDateTime(data.updated_at)} />
                <Fact
                  label="Last error"
                  tone={data.last_error ? "warning" : "success"}
                  value={data.last_error ?? "ไม่มี"}
                />
              </div>
            </section>

            <form
              className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
              onSubmit={saveConfig}
            >
              <div className="mb-4">
                <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
                  Client Credentials
                </h4>
                <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                  ช่องลับเป็น write-only และจะถูกล้างหลังบันทึก
                </p>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Field label="Environment">
                  <input
                    className="owner-v2-input"
                    disabled
                    readOnly
                    type="text"
                    value="sandbox"
                  />
                </Field>
                <Field label="Auth mode">
                  <input
                    className="owner-v2-input"
                    disabled
                    readOnly
                    type="text"
                    value="client_credentials"
                  />
                </Field>
                <Field
                  label="Client ID"
                  help={data.credentials_configured ? "กรอกเฉพาะเมื่อต้องการแทนที่ค่าเดิม" : undefined}
                >
                  <input
                    autoComplete="off"
                    className="owner-v2-input"
                    onChange={(event) => setClientId(event.target.value)}
                    placeholder="FlowAccount sandbox client id"
                    type="text"
                    value={clientId}
                  />
                </Field>
                <Field
                  label="Client Secret"
                  help={data.credentials_configured ? "ไม่แสดงค่าที่บันทึกไว้" : undefined}
                >
                  <input
                    autoComplete="new-password"
                    className="owner-v2-input"
                    onChange={(event) => setClientSecret(event.target.value)}
                    placeholder="FlowAccount sandbox client secret"
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
                  {busy === "save" ? "กำลังบันทึก..." : "บันทึก credentials"}
                </Button>
                <Button
                  disabled={busy !== null || !data.credentials_configured}
                  onClick={() => void testConnection()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "test" ? "กำลังทดสอบ..." : "ทดสอบ sandbox API"}
                </Button>
              </div>
            </form>
          </div>
        </PanelBody>
      </Panel>

      {message ? (
        <Notice tone={message.tone} title="สถานะ FlowAccount" text={message.text} />
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
        description="ผลจาก token endpoint และ /company/info หลัง sanitize แล้ว"
        action={
          <Badge color={result.ok ? "success" : "error"}>
            {result.ok ? "ผ่าน" : "ไม่ผ่าน"}
          </Badge>
        }
      />
      <PanelBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Fact label="Checked" value={formatDateTime(result.checked_at)} />
          <Fact label="Latency" value={`${result.latency_ms} ms`} />
          <Fact
            label="Provider status"
            value={result.provider_status?.toString() ?? "-"}
          />
          <Fact label="Company ID" value={result.company_id ?? "-"} />
          <Fact label="Support code" value={result.support_code ?? "-"} />
        </div>
        {result.safe_error_message ? (
          <div className="mt-4">
            <Notice
              tone="warning"
              title="Safe error"
              text={result.safe_error_message}
            />
          </div>
        ) : null}
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
