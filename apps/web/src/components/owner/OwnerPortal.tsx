"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  deriveMorningBriefDateRange,
  type LineAccessProfileKey,
  type LineChannelRecord,
  type LineDeliveryRecord,
  type LineTargetRecord,
  type ReportRunRecord,
  type SalesGoodsServicesSnapshot,
  type Tenant,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { AdminSecurityDialogs } from "@/components/command-center/AdminSecurityDialogs";
import {
  buildAdminJsonHeaders,
  buildRememberedAdminJsonHeaders,
  forgetAdminToken,
  requestAdminConfirmation,
} from "@/components/command-center/adminAuth";
import { getCommandCenterApiBaseUrl } from "@/components/command-center/apiBaseUrl";
import {
  formatLineAccessProfile,
  OwnerLineTargetsPanel,
} from "./OwnerLineTargetsPanel";

const API_BASE_URL = getCommandCenterApiBaseUrl();
const defaultReportRange = deriveMorningBriefDateRange();

type TenantSummary = {
  tenant: Tenant;
  customer_dashboard_path: string | null;
  access: {
    enabled: boolean;
    status: string;
    message: string;
  };
  health: {
    datasource_configured: boolean;
    line_channels: number;
    line_targets_total: number;
    line_targets_enabled: number;
    users: number;
    latest_report_run_at: string | null;
    latest_report_status: string | null;
    latest_snapshot_at: string | null;
    latest_line_delivery_at: string | null;
    latest_line_delivery_status: string | null;
  };
};

type ActionResult = {
  tone: "success" | "error" | "warning";
  message: string;
};

type OwnerDataStatus = "checking" | "auth_required" | "ready" | "error";

type DatasourceTestResult = {
  ok: boolean;
  checked_at: string;
  latency_ms: number;
  database_name: string | null;
  user_name_masked: string | null;
  required_tables: {
    ic_trans: boolean;
    ic_trans_detail: boolean;
    ar_customer: boolean;
    erp_branch_list: boolean;
  };
  safe_error_message: string | null;
};

type DatasourceConfigStatus = {
  source: "encrypted_store" | "env" | "missing";
  host: string | null;
  port: number | null;
  database: string | null;
  user: string | null;
  password_configured: boolean;
  encryption_configured: boolean;
  updated_at: string | null;
};

type OwnerAuditLogEntry = {
  id?: number;
  tenant_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata_json: Record<string, unknown>;
  created_at: string;
};

type OwnerOperationsStatus = {
  api: {
    ok: boolean;
    service: string;
    system_store: "postgres" | "local-json";
    time: string;
  };
  dashboard: {
    app_base_url_configured: boolean;
    dashboard_url: string | null;
    public_api_base_url_configured: boolean;
  };
  scheduler: {
    enabled: boolean;
    tenant_ids: string[];
    time: string;
    timezone: string;
    mode: "dry_run" | "send";
    force: boolean;
  };
  worker: {
    heartbeat_configured: boolean;
    latest_heartbeat: unknown | null;
    age_seconds: number | null;
    status: string;
  };
  backup: {
    system_store: "postgres" | "local-json";
    configured: boolean;
    last_backup_at: string | null;
    recommendation: string;
  };
  audit_logs: OwnerAuditLogEntry[];
};

type ValidationSignoffResult = {
  status: "accepted" | "difference_found";
  accepted: boolean;
  difference_amount: number;
};

export type OwnerPortalSection =
  | "overview"
  | "tenants"
  | "reports"
  | "line"
  | "audit";

export default function OwnerPortal({
  section = "overview",
}: {
  section?: OwnerPortalSection;
}) {
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [lineChannels, setLineChannels] = useState<LineChannelRecord[]>([]);
  const [lineTargets, setLineTargets] = useState<LineTargetRecord[]>([]);
  const [datasourceTests, setDatasourceTests] = useState<
    Record<string, DatasourceTestResult>
  >({});
  const [datasourceConfig, setDatasourceConfig] =
    useState<DatasourceConfigStatus | null>(null);
  const [datasourceHost, setDatasourceHost] = useState("");
  const [datasourcePort, setDatasourcePort] = useState("5432");
  const [datasourceDatabase, setDatasourceDatabase] = useState("");
  const [datasourceUser, setDatasourceUser] = useState("");
  const [datasourcePassword, setDatasourcePassword] = useState("");
  const [operationsStatus, setOperationsStatus] =
    useState<OwnerOperationsStatus | null>(null);
  const [dataStatus, setDataStatus] =
    useState<OwnerDataStatus>("checking");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [newTenantName, setNewTenantName] = useState("");
  const [newTenantId, setNewTenantId] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [reportDateFrom, setReportDateFrom] = useState(
    defaultReportRange.date_from,
  );
  const [reportDateTo, setReportDateTo] = useState(
    defaultReportRange.date_to,
  );
  const [lastManualRun, setLastManualRun] =
    useState<ReportRunRecord | null>(null);
  const [lastManualSnapshot, setLastManualSnapshot] =
    useState<SalesGoodsServicesSnapshot | null>(null);
  const [validationReferenceTotal, setValidationReferenceTotal] = useState("");
  const [validationSignedBy, setValidationSignedBy] = useState("");
  const [validationNote, setValidationNote] = useState("");
  const [validationSignoffResult, setValidationSignoffResult] =
    useState<ValidationSignoffResult | null>(null);
  const [lineChannelName, setLineChannelName] = useState("");
  const [lineTokenConfigured, setLineTokenConfigured] = useState(false);
  const [lineSecretConfigured, setLineSecretConfigured] = useState(false);
  const [lineSecretChannelId, setLineSecretChannelId] = useState("");
  const [lineAccessTokenInput, setLineAccessTokenInput] = useState("");
  const [lineChannelSecretInput, setLineChannelSecretInput] = useState("");
  const [publicOrigin, setPublicOrigin] = useState("");

  const activeCount = useMemo(
    () =>
      tenants.filter((item) =>
        ["trial", "active", "past_due"].includes(item.tenant.status),
      ).length,
    [tenants],
  );
  const suspendedCount = tenants.filter(
    (item) => item.tenant.status === "suspended",
  ).length;
  const selectedTenant = tenants.find(
    (item) => item.tenant.id === selectedTenantId,
  )?.tenant;
  const selectedTenantSummary = tenants.find(
    (item) => item.tenant.id === selectedTenantId,
  );
  const selectedTenantLineChannels = selectedTenantId
    ? lineChannels.filter((channel) => channel.tenant_id === selectedTenantId)
    : lineChannels;
  const selectedTenantLineTargets = selectedTenantId
    ? lineTargets.filter((target) => target.tenant_id === selectedTenantId)
    : [];
  const sectionMeta = getOwnerSectionMeta(section);

  useEffect(() => {
    void loadOwnerData({ promptForToken: false });
  }, []);

  useEffect(() => {
    setPublicOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!selectedTenantId && tenants[0]) {
      setSelectedTenantId(tenants[0].tenant.id);
    }
  }, [selectedTenantId, tenants]);

  useEffect(() => {
    if (selectedTenantId) {
      void loadDatasourceConfig(selectedTenantId);
    } else {
      setDatasourceConfig(null);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    if (
      selectedTenantLineChannels.length &&
      !selectedTenantLineChannels.some(
        (channel) => channel.id === lineSecretChannelId,
      )
    ) {
      setLineSecretChannelId(selectedTenantLineChannels[0].id);
      return;
    }
    if (!selectedTenantLineChannels.length && lineSecretChannelId) {
      setLineSecretChannelId("");
    }
  }, [lineSecretChannelId, selectedTenantLineChannels]);

  async function loadOwnerData({
    promptForToken = true,
  }: { promptForToken?: boolean } = {}) {
    setResult(null);
    try {
      const headers = promptForToken
        ? await buildAdminJsonHeaders({
            actionLabel: "เปิด Owner Admin Portal",
            description:
              "หน้านี้เห็นทุกร้านและใช้จัดการ subscription/config ระดับระบบ",
          })
        : buildRememberedAdminJsonHeaders();
      if (!headers) {
        setDataStatus("auth_required");
        return;
      }

      const [
        tenantsResponse,
        channelsResponse,
        lineTargetsResponse,
        operationsResponse,
      ] =
        await Promise.all([
          fetch(`${API_BASE_URL}/api/owner/tenants`, { headers }),
          fetch(`${API_BASE_URL}/api/owner/line-channels`, { headers }),
          fetch(`${API_BASE_URL}/api/line-targets`),
          fetch(`${API_BASE_URL}/api/owner/operations/status`, { headers }),
        ]);

      if (tenantsResponse.status === 401 || tenantsResponse.status === 403) {
        forgetAdminToken();
        setDataStatus("auth_required");
        setResult({
          tone: "warning",
          message: "Admin token ใช้ไม่ได้หรือหมดอายุ กรุณายืนยันสิทธิ์อีกครั้ง",
        });
        return;
      }

      if (!tenantsResponse.ok) {
        const payload = (await tenantsResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "โหลด tenant ไม่สำเร็จ");
      }

      const tenantsPayload = (await tenantsResponse.json()) as {
        data: TenantSummary[];
      };
      const channelsPayload = channelsResponse.ok
        ? ((await channelsResponse.json()) as { data: LineChannelRecord[] })
        : { data: [] };
      const lineTargetsPayload = lineTargetsResponse.ok
        ? ((await lineTargetsResponse.json()) as { data: LineTargetRecord[] })
        : { data: [] };
      const operationsPayload = operationsResponse.ok
        ? ((await operationsResponse.json()) as { data: OwnerOperationsStatus })
        : { data: null };
      setTenants(tenantsPayload.data);
      setLineChannels(channelsPayload.data);
      setLineTargets(lineTargetsPayload.data);
      setOperationsStatus(operationsPayload.data);
      setDataStatus("ready");
    } catch (error) {
      setDataStatus("error");
      setResult({
        tone: "error",
        message:
          error instanceof Error ? error.message : "โหลด Owner Admin ไม่สำเร็จ",
      });
    }
  }

  async function loadDatasourceConfig(tenantId: string) {
    const headers = buildRememberedAdminJsonHeaders();
    if (!headers) {
      return;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/owner/tenants/${tenantId}/datasource/config`,
      { headers },
    );
    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as {
      data: DatasourceConfigStatus;
    };
    setDatasourceConfig(payload.data);
    setDatasourceHost(payload.data.host ?? "");
    setDatasourcePort(String(payload.data.port ?? 5432));
    setDatasourceDatabase(payload.data.database ?? "");
    setDatasourceUser(payload.data.user ?? "");
    setDatasourcePassword("");
  }

  async function saveDatasourceConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "กรุณาเลือกร้านค้าก่อนบันทึก datasource" });
      return;
    }

    await runOwnerAction(`datasource-save-${tenant.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันบันทึก SML datasource",
        message:
          "ระบบจะเข้ารหัส password ก่อนเก็บใน system store และบันทึก audit โดยไม่แสดง password เต็ม",
        confirmLabel: "บันทึก datasource",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          { label: "Host", value: datasourceHost },
          { label: "Database", value: datasourceDatabase },
          { label: "User", value: datasourceUser },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: `บันทึก datasource ของ ${tenant.name}`,
        description:
          "ใช้สำหรับให้ API/worker ต่อ SML PostgreSQL โดย password จะถูกเข้ารหัสฝั่ง server",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนบันทึก datasource");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}/datasource/config`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            host: datasourceHost.trim(),
            port: Number(datasourcePort),
            database: datasourceDatabase.trim(),
            user: datasourceUser.trim(),
            password: datasourcePassword,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: DatasourceConfigStatus;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "บันทึก datasource ไม่สำเร็จ");
      }

      setDatasourceConfig(payload.data);
      setDatasourcePassword("");
      setResult({
        tone: "success",
        message: "บันทึก datasource แบบเข้ารหัสแล้ว",
      });
      await loadOwnerData();
    });
  }

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tenantName = newTenantName.trim();
    const tenantId = (newTenantId.trim() || slugifyTenantId(tenantName)).trim();
    if (!tenantName || !tenantId) {
      setResult({ tone: "warning", message: "กรุณากรอกชื่อร้านค้า" });
      return;
    }

    await runOwnerAction("create", async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "เพิ่มร้านค้าใหม่",
        description: "สร้าง tenant ใหม่ในระบบ SaaS pilot",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนเพิ่มร้านค้า");
      }

      const response = await fetch(`${API_BASE_URL}/api/owner/tenants`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tenant_id: tenantId,
          name: tenantName,
          status: "trial",
          plan_code: "starter",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เพิ่มร้านค้าไม่สำเร็จ");
      }

      setNewTenantName("");
      setNewTenantId("");
      setSelectedTenantId(tenantId);
      setResult({ tone: "success", message: "เพิ่มร้านค้าใหม่แล้ว" });
      await loadOwnerData();
    });
  }

  async function createLineChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = lineChannelName.trim();
    if (!selectedTenantId || !displayName) {
      setResult({
        tone: "warning",
        message: "กรุณาเลือกร้านค้าและกรอกชื่อ LINE OA",
      });
      return;
    }

    await runOwnerAction("create-line-channel", async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "เพิ่ม LINE OA ให้ร้านค้า",
        description:
          "บันทึก LINE OA metadata สำหรับ tenant นี้ โดยไม่แสดง token/secret ใน UI",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนเพิ่ม LINE OA");
      }

      const response = await fetch(`${API_BASE_URL}/api/owner/line-channels`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          tenant_id: selectedTenantId,
          display_name: displayName,
          channel_access_token_configured: lineTokenConfigured,
          channel_secret_configured: lineSecretConfigured,
          enabled: true,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เพิ่ม LINE OA ไม่สำเร็จ");
      }

      setLineChannelName("");
      setResult({ tone: "success", message: "เพิ่ม LINE OA ให้ร้านค้าแล้ว" });
      await loadOwnerData();
    });
  }

  async function saveLineChannelSecretConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const channel = lineChannels.find((item) => item.id === lineSecretChannelId);
    if (!channel) {
      setResult({ tone: "warning", message: "กรุณาเลือก LINE OA ก่อนบันทึก secret" });
      return;
    }
    if (!lineAccessTokenInput.trim() && !lineChannelSecretInput.trim()) {
      setResult({
        tone: "warning",
        message: "กรุณาใส่ Channel access token หรือ Channel secret อย่างน้อย 1 ค่า",
      });
      return;
    }

    await runOwnerAction(`line-secrets-${channel.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันบันทึก LINE OA secret",
        message:
          "ระบบจะเข้ารหัส token/secret ก่อนเก็บ และจะไม่แสดงค่าเต็มใน UI หรือ audit log",
        confirmLabel: "บันทึก LINE secret",
        details: [
          { label: "ร้านค้า", value: selectedTenant?.name ?? channel.tenant_id },
          { label: "LINE OA", value: channel.display_name },
          {
            label: "ข้อมูลที่จะบันทึก",
            value: [
              lineAccessTokenInput.trim() ? "Channel access token" : null,
              lineChannelSecretInput.trim() ? "Channel secret" : null,
            ]
              .filter(Boolean)
              .join(", "),
          },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: `บันทึก LINE secret ของ ${channel.display_name}`,
        description:
          "ใช้สำหรับส่ง Morning Brief และตรวจ webhook ของ LINE OA นี้",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนบันทึก LINE secret");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/line-channels/${channel.id}/secrets`,
        {
          method: "PUT",
          headers,
          body: JSON.stringify({
            channel_access_token: lineAccessTokenInput.trim() || undefined,
            channel_secret: lineChannelSecretInput.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: LineChannelRecord;
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "บันทึก LINE secret ไม่สำเร็จ");
      }

      setLineAccessTokenInput("");
      setLineChannelSecretInput("");
      setResult({ tone: "success", message: "บันทึก LINE secret แบบเข้ารหัสแล้ว" });
      await loadOwnerData();
    });
  }

  async function approveLineTarget(
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) {
    await runOwnerAction(`approve-line-target-${target.id}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: "อนุมัติกลุ่ม LINE",
        description:
          "เปิดให้กลุ่มนี้รับ Morning Brief ตามสิทธิ์ที่เลือก โดยไม่เปิดเผย target id เต็ม",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนอนุมัติกลุ่ม LINE");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/line-targets/${target.id}/approve`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            access_profile_key: profileKey,
            enabled: true,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: LineTargetRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "อนุมัติกลุ่ม LINE ไม่สำเร็จ");
      }

      setSelectedTenantId(payload.data.tenant_id);
      setResult({
        tone: "success",
        message: `อนุมัติ ${payload.data.display_name} เป็น ${formatLineAccessProfile(payload.data.access_profile_key)} แล้ว`,
      });
      await loadOwnerData();
    });
  }

  async function updateLineTargetProfile(
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) {
    await runOwnerAction(
      `line-target-profile-${target.id}-${profileKey}`,
      async () => {
        const headers = await buildAdminJsonHeaders({
          actionLabel: "เปลี่ยนสิทธิ์กลุ่ม LINE",
          description:
            "ปรับสิทธิ์รายงานของกลุ่มนี้ เช่น ผู้บริหาร ฝ่ายขาย ปฏิบัติการ หรือพนักงาน",
        });
        if (!headers) {
          throw new Error("ต้องกรอก Admin token ก่อนเปลี่ยนสิทธิ์กลุ่ม LINE");
        }

        const response = await fetch(
          `${API_BASE_URL}/api/line-targets/${target.id}`,
          {
            method: "PATCH",
            headers,
            body: JSON.stringify({ access_profile_key: profileKey }),
          },
        );
        const payload = (await response.json().catch(() => ({}))) as {
          data?: LineTargetRecord;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error || "เปลี่ยนสิทธิ์กลุ่ม LINE ไม่สำเร็จ");
        }

        setResult({
          tone: "success",
          message: `${payload.data.display_name}: ${formatLineAccessProfile(payload.data.access_profile_key)}`,
        });
        await loadOwnerData();
      },
    );
  }

  async function toggleLineTarget(target: LineTargetRecord) {
    await runOwnerAction(`line-target-toggle-${target.id}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: target.enabled
          ? "ปิดรับ Morning Brief"
          : "เปิดรับ Morning Brief",
        description:
          "เปลี่ยนเฉพาะสถานะเปิด/ปิดของกลุ่มนี้ ไม่เปลี่ยน profile สิทธิ์รายงาน",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนเปลี่ยนสถานะกลุ่ม LINE");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/line-targets/${target.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({ enabled: !target.enabled }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: LineTargetRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "เปลี่ยนสถานะกลุ่ม LINE ไม่สำเร็จ");
      }

      setResult({
        tone: "success",
        message: payload.data.enabled
          ? "เปิดรับ Morning Brief ให้กลุ่มนี้แล้ว"
          : "ปิดรับ Morning Brief ให้กลุ่มนี้แล้ว",
      });
      await loadOwnerData();
    });
  }

  async function testLineTarget(target: LineTargetRecord) {
    await runOwnerAction(`line-target-test-${target.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันส่ง LINE test จริง",
        message:
          "ระบบจะส่ง Flex Morning Brief ทดสอบไปยังปลายทางนี้เท่านั้น เพื่อยืนยันว่ากลุ่มรับข้อความได้จริง",
        confirmLabel: "ส่งทดสอบ",
        tone: "danger",
        details: [
          { label: "กลุ่ม/ปลายทาง", value: target.display_name },
          { label: "รหัสปลายทาง", value: target.target_id_masked },
          {
            label: "สิทธิ์",
            value: formatLineAccessProfile(target.access_profile_key),
          },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: "ส่ง LINE test จริง",
        description:
          "ใช้ทดสอบเฉพาะกลุ่มนี้หลัง owner อนุมัติสิทธิ์แล้ว",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนส่ง LINE test");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/line-targets/${target.id}/test-send`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ mode: "send" }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { delivery?: LineDeliveryRecord };
        error?: string;
      };

      if (!response.ok || !payload.data?.delivery) {
        throw new Error(payload.error || "ส่ง LINE test ไม่สำเร็จ");
      }

      setResult({
        tone:
          payload.data.delivery.status === "success" ? "success" : "warning",
        message:
          payload.data.delivery.status === "success"
            ? "ส่ง LINE test สำเร็จ"
            : payload.data.delivery.safe_error_message ??
              "ส่ง LINE test แล้วแต่ยังไม่สำเร็จ",
      });
      await loadOwnerData();
    });
  }

  async function updateTenantStatus(
    tenant: Tenant,
    status: Tenant["status"],
  ) {
    await runOwnerAction(`${tenant.id}-${status}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: `เปลี่ยนสถานะร้าน ${tenant.name}`,
        description:
          status === "suspended"
            ? "ร้านนี้จะถูกบล็อก dashboard และหยุดส่ง LINE"
            : "อัปเดตสถานะ subscription ของร้านนี้",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนเปลี่ยนสถานะร้าน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status,
            suspended_reason:
              status === "suspended" ? "ระงับโดย Owner Admin" : null,
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(payload.error || "เปลี่ยนสถานะร้านไม่สำเร็จ");
      }

      setResult({ tone: "success", message: "อัปเดตสถานะร้านแล้ว" });
      await loadOwnerData();
    });
  }

  async function testDatasource(tenantId: string) {
    const tenant = tenants.find((item) => item.tenant.id === tenantId)?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "ไม่พบร้านค้าที่ต้องการทดสอบ" });
      return;
    }

    await runOwnerAction(`datasource-${tenantId}`, async () => {
      const headers = await buildAdminJsonHeaders({
        actionLabel: `ทดสอบ SML datasource ของ ${tenant.name}`,
        description:
          "ตรวจการเชื่อมต่อฐานข้อมูล SML และตารางหลัก โดยไม่แสดง password หรือ credential เต็มใน UI",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนทดสอบ SML datasource");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenantId}/datasource/test`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: DatasourceTestResult;
        error?: string;
      };

      if (payload.data) {
        setDatasourceTests((previous) => ({
          ...previous,
          [tenantId]: payload.data as DatasourceTestResult,
        }));
        await loadOwnerData();
        setResult({
          tone: payload.data.ok ? "success" : "warning",
          message: payload.data.ok
            ? `เชื่อมต่อ SML ของ ${tenant.name} สำเร็จ`
            : toDatasourceBusinessMessage(payload.data.safe_error_message),
        });
        return;
      }

      throw new Error(payload.error || "ทดสอบ SML datasource ไม่สำเร็จ");
    });
  }

  async function runSalesReport() {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant) {
      setResult({ tone: "warning", message: "กรุณาเลือกร้านค้าก่อนรันรายงาน" });
      return;
    }
    if (!reportDateFrom || !reportDateTo || reportDateFrom > reportDateTo) {
      setResult({
        tone: "warning",
        message: "กรุณาเลือกช่วงวันที่ให้ถูกต้อง",
      });
      return;
    }

    await runOwnerAction(`report-run-${tenant.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันรันรายงาน SML",
        message:
          "ระบบจะ query ฐานข้อมูล SML ของร้านนี้และบันทึก snapshot ล่าสุดให้ dashboard และ LINE ใช้ต่อ",
        confirmLabel: "รันรายงาน",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          {
            label: "รายงาน",
            value: "รายงานขายสินค้าและบริการ",
          },
          {
            label: "ช่วงวันที่",
            value: formatReportPeriod(reportDateFrom, reportDateTo),
          },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: "รันรายงานขายสินค้าและบริการ",
        description:
          "ระบบจะ query ฐาน SML ของ tenant นี้และบันทึก snapshot ล่าสุด",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนรันรายงาน");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/reports/${tenant.id}/sales_goods_services/run`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            date_from: reportDateFrom,
            date_to: reportDateTo,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: SalesGoodsServicesSnapshot;
        run?: ReportRunRecord;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        if (response.status === 401 || response.status === 403) {
          forgetAdminToken();
        }
        if (payload.run) {
          setLastManualRun(payload.run);
        }
        throw new Error(payload.error || "รันรายงานไม่สำเร็จ");
      }

      setLastManualSnapshot(payload.data);
      setLastManualRun(payload.run ?? null);
      setValidationSignoffResult(null);
      setResult({
        tone: "success",
        message: `${tenant.name}: รันรายงานสำเร็จ ยอดขาย ${formatCurrency(payload.data.summary.total_sales)} จาก ${payload.data.summary.document_count.toLocaleString("th-TH")} บิล`,
      });
      await loadOwnerData();
    });
  }

  async function saveValidationSignoff() {
    const tenant = selectedTenantSummary?.tenant;
    if (!tenant || !lastManualSnapshot) {
      setResult({
        tone: "warning",
        message: "กรุณารันรายงานให้สำเร็จก่อนบันทึกการรับรองยอด",
      });
      return;
    }
    if (
      lastManualSnapshot.tenant_id !== tenant.id ||
      lastManualSnapshot.params.date_from !== reportDateFrom ||
      lastManualSnapshot.params.date_to !== reportDateTo
    ) {
      setResult({
        tone: "warning",
        message:
          "snapshot ล่าสุดในหน้านี้ไม่ตรงกับร้านหรือช่วงวันที่ กรุณารันรายงานใหม่ก่อนรับรองยอด",
      });
      return;
    }

    const referenceTotal = Number(validationReferenceTotal);
    if (!Number.isFinite(referenceTotal)) {
      setResult({
        tone: "warning",
        message: "กรุณากรอกยอดจากรายงาน SML เดิมเป็นตัวเลข",
      });
      return;
    }
    if (validationSignedBy.trim().length < 2) {
      setResult({
        tone: "warning",
        message: "กรุณากรอกชื่อผู้ตรวจ/ผู้รับรองยอด",
      });
      return;
    }

    await runOwnerAction(`validation-signoff-${tenant.id}`, async () => {
      const confirmed = await requestAdminConfirmation({
        title: "ยืนยันบันทึกการรับรองยอด",
        message:
          "ระบบจะบันทึกหลักฐานว่า owner/ลูกค้าตรวจเทียบยอดกับรายงาน SML เดิมแล้ว รายการนี้จะถูกเก็บใน audit log",
        confirmLabel: "บันทึกการรับรอง",
        details: [
          { label: "ร้านค้า", value: tenant.name },
          {
            label: "ช่วงวันที่",
            value: formatReportPeriod(reportDateFrom, reportDateTo),
          },
          {
            label: "ยอดระบบ",
            value: `${formatCurrency(lastManualSnapshot.summary.total_sales)} บาท`,
          },
          {
            label: "ยอด SML เดิม",
            value: `${formatCurrency(referenceTotal)} บาท`,
          },
        ],
      });
      if (!confirmed) {
        return;
      }

      const headers = await buildAdminJsonHeaders({
        actionLabel: "บันทึกการรับรองยอด",
        description:
          "ใช้ยืนยันว่า report snapshot รอบนี้ถูกเทียบกับรายงาน SML เดิมแล้ว",
      });
      if (!headers) {
        throw new Error("ต้องกรอก Admin token ก่อนบันทึกการรับรองยอด");
      }

      const response = await fetch(
        `${API_BASE_URL}/api/owner/tenants/${tenant.id}/reports/sales_goods_services/validation-signoff`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            run_id: lastManualSnapshot.run_id,
            date_from: reportDateFrom,
            date_to: reportDateTo,
            system_total: lastManualSnapshot.summary.total_sales,
            reference_total: referenceTotal,
            signed_by: validationSignedBy.trim(),
            note: validationNote.trim() || undefined,
          }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        data?: ValidationSignoffResult;
        error?: string;
      };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "บันทึกการรับรองยอดไม่สำเร็จ");
      }

      setValidationSignoffResult(payload.data);
      setResult({
        tone: payload.data.accepted ? "success" : "warning",
        message: payload.data.accepted
          ? "บันทึกการรับรองยอดแล้ว: ยอดตรง"
          : `บันทึกแล้ว แต่พบส่วนต่าง ${formatCurrency(payload.data.difference_amount)} บาท`,
      });
      await loadOwnerData();
    });
  }

  async function runOwnerAction(name: string, action: () => Promise<void>) {
    setBusy(name);
    try {
      await action();
    } catch (error) {
      setResult({
        tone: "error",
        message:
          error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <AdminSecurityDialogs />

      <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-medium text-brand-500">
              {sectionMeta.eyebrow}
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white">
              {sectionMeta.title}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {sectionMeta.description}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge color={dataStatus === "ready" ? "success" : "light"}>
              ใช้งาน {dataStatus === "ready" ? activeCount : "-"}
            </Badge>
            <Badge color={suspendedCount ? "warning" : "light"}>
              ระงับ {dataStatus === "ready" ? suspendedCount : "-"}
            </Badge>
            <Badge color="light">
              {dataStatus === "ready" ? lineChannels.length : "-"} LINE OA
            </Badge>
            <Button size="sm" variant="outline" onClick={() => void loadOwnerData()}>
              รีเฟรช
            </Button>
          </div>
        </div>
      </div>

      {result && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            result.tone === "success"
              ? "border-success-200 bg-success-50 text-success-700"
              : result.tone === "warning"
              ? "border-warning-200 bg-warning-50 text-warning-700"
              : "border-error-200 bg-error-50 text-error-700"
          }`}
        >
          {result.message}
        </div>
      )}

      {dataStatus === "auth_required" ? (
        <OwnerAuthGate onVerify={() => void loadOwnerData({ promptForToken: true })} />
      ) : null}

      {dataStatus === "checking" ? <OwnerLoadingState /> : null}

      {dataStatus === "ready" ? (
        <OwnerSectionContent
          busy={busy}
          createLineChannel={createLineChannel}
          createTenant={createTenant}
          datasourceConfig={datasourceConfig}
          datasourceDatabase={datasourceDatabase}
          datasourceHost={datasourceHost}
          datasourcePassword={datasourcePassword}
          datasourcePort={datasourcePort}
          datasourceUser={datasourceUser}
          datasourceTests={datasourceTests}
          lastManualRun={lastManualRun}
          lastManualSnapshot={lastManualSnapshot}
          lineAccessTokenInput={lineAccessTokenInput}
          lineChannelName={lineChannelName}
          lineChannelSecretInput={lineChannelSecretInput}
          lineChannels={lineChannels}
          lineTargets={lineTargets}
          lineSecretChannelId={lineSecretChannelId}
          lineSecretConfigured={lineSecretConfigured}
          lineTokenConfigured={lineTokenConfigured}
          newTenantId={newTenantId}
          newTenantName={newTenantName}
          onApproveLineTarget={approveLineTarget}
          onSetLineTargetProfile={updateLineTargetProfile}
          onSaveDatasourceConfig={saveDatasourceConfig}
          onSaveLineChannelSecrets={saveLineChannelSecretConfig}
          onTestDatasource={testDatasource}
          onTestLineTarget={testLineTarget}
          onToggleLineTarget={toggleLineTarget}
          onUpdateStatus={updateTenantStatus}
          onSaveValidationSignoff={saveValidationSignoff}
          operationsStatus={operationsStatus}
          publicOrigin={publicOrigin}
          reportDateFrom={reportDateFrom}
          reportDateTo={reportDateTo}
          section={section}
          selectedTenant={selectedTenant}
          selectedTenantId={selectedTenantId}
          selectedTenantLineChannels={selectedTenantLineChannels}
          selectedTenantLineTargets={selectedTenantLineTargets}
          selectedTenantSummary={selectedTenantSummary}
          setDatasourceDatabase={setDatasourceDatabase}
          setDatasourceHost={setDatasourceHost}
          setDatasourcePassword={setDatasourcePassword}
          setDatasourcePort={setDatasourcePort}
          setDatasourceUser={setDatasourceUser}
          setLineAccessTokenInput={setLineAccessTokenInput}
          setLineChannelName={setLineChannelName}
          setLineChannelSecretInput={setLineChannelSecretInput}
          setLineSecretChannelId={setLineSecretChannelId}
          setLineSecretConfigured={setLineSecretConfigured}
          setLineTokenConfigured={setLineTokenConfigured}
          setNewTenantId={setNewTenantId}
          setNewTenantName={setNewTenantName}
          setReportDateFrom={setReportDateFrom}
          setReportDateTo={setReportDateTo}
          setSelectedTenantId={setSelectedTenantId}
          tenants={tenants}
          validationNote={validationNote}
          validationReferenceTotal={validationReferenceTotal}
          validationSignedBy={validationSignedBy}
          validationSignoffResult={validationSignoffResult}
          setValidationNote={setValidationNote}
          setValidationReferenceTotal={setValidationReferenceTotal}
          setValidationSignedBy={setValidationSignedBy}
          onRunSalesReport={runSalesReport}
        />
      ) : null}

    </div>
  );
}

function OwnerAuthGate({ onVerify }: { onVerify: () => void }) {
  return (
    <section className="rounded-xl border border-warning-200 bg-warning-50 p-5 dark:border-warning-500/30 dark:bg-warning-500/10">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <Badge color="warning">ต้องยืนยันสิทธิ์</Badge>
          <h2 className="mt-3 text-lg font-semibold text-gray-900 dark:text-white">
            ยืนยัน Admin token เพื่อโหลดข้อมูลร้านค้า
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-300">
            เพื่อไม่ให้หน้า owner แสดงข้อมูลผิดหรือโหลดค้าง ระบบจะยังไม่แสดง tenant,
            datasource และ LINE config จนกว่าจะยืนยันสิทธิ์ผู้ดูแล
          </p>
        </div>
        <Button onClick={onVerify} size="sm">
          ยืนยันสิทธิ์ผู้ดูแล
        </Button>
      </div>
    </section>
  );
}

function OwnerLoadingState() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <Badge color="light">กำลังโหลด</Badge>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="h-20 rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
        <div className="h-20 rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
        <div className="h-20 rounded-lg bg-gray-100 dark:bg-white/[0.04]" />
      </div>
    </section>
  );
}

type OwnerSectionContentProps = {
  busy: string | null;
  createLineChannel: (event: FormEvent<HTMLFormElement>) => void;
  createTenant: (event: FormEvent<HTMLFormElement>) => void;
  datasourceConfig: DatasourceConfigStatus | null;
  datasourceDatabase: string;
  datasourceHost: string;
  datasourcePassword: string;
  datasourcePort: string;
  datasourceUser: string;
  datasourceTests: Record<string, DatasourceTestResult>;
  lastManualRun: ReportRunRecord | null;
  lastManualSnapshot: SalesGoodsServicesSnapshot | null;
  lineAccessTokenInput: string;
  lineChannelName: string;
  lineChannelSecretInput: string;
  lineChannels: LineChannelRecord[];
  lineTargets: LineTargetRecord[];
  lineSecretChannelId: string;
  lineSecretConfigured: boolean;
  lineTokenConfigured: boolean;
  newTenantId: string;
  newTenantName: string;
  onApproveLineTarget: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onSetLineTargetProfile: (
    target: LineTargetRecord,
    profileKey: LineAccessProfileKey,
  ) => Promise<void>;
  onRunSalesReport: () => Promise<void>;
  onSaveDatasourceConfig: (event: FormEvent<HTMLFormElement>) => void;
  onSaveLineChannelSecrets: (event: FormEvent<HTMLFormElement>) => void;
  onTestDatasource: (tenantId: string) => Promise<void>;
  onTestLineTarget: (target: LineTargetRecord) => Promise<void>;
  onToggleLineTarget: (target: LineTargetRecord) => Promise<void>;
  onUpdateStatus: (
    tenant: Tenant,
    status: Tenant["status"],
  ) => Promise<void>;
  onSaveValidationSignoff: () => Promise<void>;
  operationsStatus: OwnerOperationsStatus | null;
  publicOrigin: string;
  reportDateFrom: string;
  reportDateTo: string;
  section: OwnerPortalSection;
  selectedTenant?: Tenant;
  selectedTenantId: string;
  selectedTenantLineChannels: LineChannelRecord[];
  selectedTenantLineTargets: LineTargetRecord[];
  selectedTenantSummary?: TenantSummary;
  setDatasourceDatabase: (value: string) => void;
  setDatasourceHost: (value: string) => void;
  setDatasourcePassword: (value: string) => void;
  setDatasourcePort: (value: string) => void;
  setDatasourceUser: (value: string) => void;
  setLineAccessTokenInput: (value: string) => void;
  setLineChannelName: (value: string) => void;
  setLineChannelSecretInput: (value: string) => void;
  setLineSecretChannelId: (value: string) => void;
  setLineSecretConfigured: (value: boolean) => void;
  setLineTokenConfigured: (value: boolean) => void;
  setNewTenantId: (value: string) => void;
  setNewTenantName: (value: string) => void;
  setReportDateFrom: (value: string) => void;
  setReportDateTo: (value: string) => void;
  setSelectedTenantId: (value: string) => void;
  setValidationNote: (value: string) => void;
  setValidationReferenceTotal: (value: string) => void;
  setValidationSignedBy: (value: string) => void;
  tenants: TenantSummary[];
  validationNote: string;
  validationReferenceTotal: string;
  validationSignedBy: string;
  validationSignoffResult: ValidationSignoffResult | null;
};

function OwnerSectionContent(props: OwnerSectionContentProps) {
  if (props.section === "tenants") {
    return <OwnerTenantsContent {...props} />;
  }
  if (props.section === "reports") {
    return <OwnerReportsContent {...props} />;
  }
  if (props.section === "line") {
    return <OwnerLineContent {...props} />;
  }
  if (props.section === "audit") {
    return (
      <OwnerAuditContent
        operationsStatus={props.operationsStatus}
        tenants={props.tenants}
      />
    );
  }
  return <OwnerOverviewContent {...props} />;
}

function getOwnerSectionMeta(section: OwnerPortalSection) {
  const meta: Record<
    OwnerPortalSection,
    { eyebrow: string; title: string; description: string }
  > = {
    overview: {
      eyebrow: "Owner cockpit",
      title: "ภาพรวมระบบลูกค้า",
      description:
        "ดูสถานะทุกร้าน งานที่ต้องทำต่อ และจุดเสี่ยงก่อนส่งรายงานให้ลูกค้า",
    },
    tenants: {
      eyebrow: "Tenant operations",
      title: "ร้านค้าและการใช้งาน",
      description:
        "เพิ่มร้าน คุม subscription ตรวจ SML datasource และเปิด dashboard ลูกค้า",
    },
    reports: {
      eyebrow: "Report operations",
      title: "รายงานและ snapshot",
      description:
        "ติดตามรายงานขายล่าสุดต่อร้าน และเข้า runner เฉพาะเมื่อต้องรัน manual",
    },
    line: {
      eyebrow: "LINE operations",
      title: "LINE OA และสิทธิ์กลุ่ม",
      description:
        "จัดการช่องทาง LINE OA กลุ่มที่รออนุมัติ สิทธิ์การรับ Morning Brief และ test send",
    },
    audit: {
      eyebrow: "System history",
      title: "ประวัติระบบ",
      description:
        "ตรวจรอบรายงานล่าสุด การส่ง LINE ล่าสุด และจุดที่ต้อง trace ต่อ",
    },
  };

  return meta[section];
}

function OwnerStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <p className="text-xs font-medium uppercase text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function OwnerPanelHeader({
  actionHref,
  actionLabel,
  description,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  description: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
      <div>
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
          {title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
          {description}
        </p>
      </div>
      {actionHref && actionLabel ? (
        <Link
          className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
          href={actionHref}
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

function TenantOperationsTable({ tenants }: { tenants: TenantSummary[] }) {
  return (
    <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
      {tenants.map((item) => {
        const readiness = getTenantReadiness(item);
        return (
          <div
            className="grid gap-3 p-4 lg:grid-cols-[minmax(180px,1.1fr)_120px_120px_150px_120px] lg:items-center"
            key={item.tenant.id}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-gray-900 dark:text-white">
                  {item.tenant.name}
                </p>
                <Badge color={tenantStatusTone(item.tenant.status)}>
                  {formatTenantStatus(item.tenant.status)}
                </Badge>
              </div>
              <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                {item.tenant.id} · ฐาน {item.tenant.databaseName || "ยังไม่ตั้งค่า"}
              </p>
            </div>
            <CompactFact
              label="Pilot"
              value={readiness.label}
            />
            <CompactFact
              label="SML"
              value={item.health.datasource_configured ? "พร้อม" : "ต้องตั้งค่า"}
            />
            <CompactFact
              label="LINE"
              value={`${item.health.line_channels} OA · ${item.health.line_targets_enabled}/${item.health.line_targets_total} กลุ่ม`}
            />
            <div className="flex gap-2 lg:justify-end">
              <Link
                className="inline-flex h-9 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                href={item.customer_dashboard_path ?? "/app"}
                target="_blank"
              >
                Dashboard
              </Link>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OwnerFlowCard() {
  const steps = [
    "เพิ่มร้าน",
    "เชื่อม SML",
    "รันรายงาน",
    "ตั้ง LINE OA",
    "อนุมัติกลุ่ม",
    "ส่งทดสอบ",
  ];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">
        Flow เปิดร้านใหม่
      </h2>
      <div className="mt-4 space-y-2">
        {steps.map((step, index) => (
          <div className="flex items-center gap-3" key={step}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              {index + 1}
            </span>
            <p className="text-sm text-gray-700 dark:text-gray-300">{step}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function OwnerOverviewContent({
  tenants,
  lineChannels,
}: OwnerSectionContentProps) {
  const activeTenants = tenants.filter((item) => item.access.enabled);
  const readyTenants = tenants.filter(
    (item) => getTenantReadiness(item).readyCount === getTenantReadiness(item).items.length,
  );
  const actionItems = buildOwnerActionItems(tenants);

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-4">
        <OwnerStatCard label="ร้านทั้งหมด" value={`${tenants.length}`} />
        <OwnerStatCard label="เปิดใช้งาน" value={`${activeTenants.length}`} />
        <OwnerStatCard label="พร้อม pilot" value={`${readyTenants.length}`} />
        <OwnerStatCard label="LINE OA" value={`${lineChannels.length}`} />
      </section>

      <OwnerRolloutBoard tenants={tenants} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <OwnerPanelHeader
            title="ร้านค้า"
            description="มุมมองรวมสำหรับติดตามว่าแต่ละร้านพร้อมให้บริการหรือยัง"
            actionHref="/owner/tenants"
            actionLabel="จัดการร้านค้า"
          />
          <TenantOperationsTable tenants={tenants} />
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              สิ่งที่ควรทำต่อ
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              แสดงเฉพาะงานที่กระทบ rollout หรือการส่ง Morning Brief
            </p>
            <div className="mt-4 space-y-3">
              {actionItems.length ? (
                actionItems.slice(0, 6).map((item) => (
                  <div
                    className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
                    key={`${item.tenantName}-${item.title}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">
                          {item.title}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                          {item.tenantName} · {item.description}
                        </p>
                      </div>
                      <Badge color={item.tone}>{item.label}</Badge>
                    </div>
                  </div>
                ))
              ) : (
                <p className="rounded-lg border border-success-100 bg-success-50 p-3 text-sm text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-300">
                  ทุก tenant หลักพร้อมสำหรับ pilot รอบนี้
                </p>
              )}
            </div>
          </div>

          <OwnerFlowCard />
        </div>
      </section>
    </div>
  );
}

function OwnerRolloutBoard({ tenants }: { tenants: TenantSummary[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <OwnerPanelHeader
        title="Pilot rollout board"
        description="สรุปขั้นตอนที่เหลือของแต่ละร้าน เพื่อให้ owner รู้ทันทีว่าต้องไปทำอะไรต่อก่อนส่งให้ลูกค้า"
      />
      <div className="grid gap-3 border-t border-gray-100 p-4 dark:border-gray-800 lg:grid-cols-2">
        {tenants.map((item) => {
          const readiness = getTenantReadiness(item);
          const nextStep = getTenantNextStep(item, readiness.items);
          const progressPercent = Math.round(
            (readiness.readyCount / readiness.items.length) * 100,
          );

          return (
            <div
              className="rounded-xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.02]"
              key={item.tenant.id}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-gray-900 dark:text-white">
                      {item.tenant.name}
                    </h3>
                    <Badge color={readiness.tone}>{readiness.label}</Badge>
                    <Badge color={tenantStatusTone(item.tenant.status)}>
                      {formatTenantStatus(item.tenant.status)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    {nextStep.description}
                  </p>
                </div>
                <Link
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                  href={nextStep.href}
                >
                  {nextStep.actionLabel}
                </Link>
              </div>

              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                  <div
                    className={`h-full rounded-full ${
                      readiness.tone === "success"
                        ? "bg-success-500"
                        : readiness.tone === "warning"
                          ? "bg-warning-500"
                          : "bg-error-500"
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  {readiness.items.slice(0, 6).map((check) => (
                    <div
                      className="flex items-start gap-2 text-xs leading-5"
                      key={check.label}
                    >
                      <span
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          check.ok ? "bg-success-500" : "bg-warning-500"
                        }`}
                      />
                      <span className="text-gray-600 dark:text-gray-400">
                        {check.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function OwnerTenantsContent({
  busy,
  createTenant,
  datasourceConfig,
  datasourceDatabase,
  datasourceHost,
  datasourcePassword,
  datasourcePort,
  datasourceUser,
  datasourceTests,
  newTenantId,
  newTenantName,
  onSaveDatasourceConfig,
  onTestDatasource,
  onUpdateStatus,
  selectedTenantId,
  selectedTenantSummary,
  setDatasourceDatabase,
  setDatasourceHost,
  setDatasourcePassword,
  setDatasourcePort,
  setDatasourceUser,
  setNewTenantId,
  setNewTenantName,
  setSelectedTenantId,
  tenants,
}: OwnerSectionContentProps) {
  return (
    <div className="space-y-4">
      <OwnerSetupPanel
        busy={busy}
        createTenant={createTenant}
        newTenantId={newTenantId}
        newTenantName={newTenantName}
        setNewTenantId={setNewTenantId}
        setNewTenantName={setNewTenantName}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                ร้านค้าและสิทธิ์การใช้งาน
              </h2>
              <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                ร้านที่ถูกระงับจะเข้า `/app` ไม่ได้ และ scheduler จะไม่ส่ง Morning Brief
                ให้ทุกกลุ่มของร้านนั้น
              </p>
            </div>
            <select
              className="h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setSelectedTenantId(event.target.value)}
              value={selectedTenantId}
            >
              {tenants.map((item) => (
                <option key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.name}
                </option>
              ))}
            </select>
          </div>

          <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {tenants.map((item) => (
              <TenantCard
                busy={busy}
                datasourceTest={datasourceTests[item.tenant.id]}
                item={item}
                key={item.tenant.id}
                onSelectTenant={setSelectedTenantId}
                onUpdateStatus={onUpdateStatus}
                selected={item.tenant.id === selectedTenantId}
              />
            ))}
          </div>
        </div>

        <TenantDetailPanel
          busy={busy}
          datasourceConfig={datasourceConfig}
          datasourceDatabase={datasourceDatabase}
          datasourceHost={datasourceHost}
          datasourcePassword={datasourcePassword}
          datasourcePort={datasourcePort}
          datasourceUser={datasourceUser}
          datasourceTest={
            selectedTenantId ? datasourceTests[selectedTenantId] : undefined
          }
          item={selectedTenantSummary}
          onSaveDatasourceConfig={onSaveDatasourceConfig}
          onTestDatasource={onTestDatasource}
          setDatasourceDatabase={setDatasourceDatabase}
          setDatasourceHost={setDatasourceHost}
          setDatasourcePassword={setDatasourcePassword}
          setDatasourcePort={setDatasourcePort}
          setDatasourceUser={setDatasourceUser}
        />
      </section>
    </div>
  );
}

function OwnerReportsContent({
  busy,
  lastManualRun,
  lastManualSnapshot,
  onRunSalesReport,
  onSaveValidationSignoff,
  reportDateFrom,
  reportDateTo,
  selectedTenantId,
  selectedTenantSummary,
  setReportDateFrom,
  setReportDateTo,
  setSelectedTenantId,
  setValidationNote,
  setValidationReferenceTotal,
  setValidationSignedBy,
  tenants,
  validationNote,
  validationReferenceTotal,
  validationSignedBy,
  validationSignoffResult,
}: OwnerSectionContentProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <OwnerPanelHeader
          title="รายงานขายสินค้าและบริการ"
          description="ดูสถานะ snapshot ล่าสุดต่อร้าน และรัน approved report ได้จาก Owner Portal"
        />
        <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {tenants.map((item) => (
            <ReportTenantRow
              item={item}
              key={item.tenant.id}
              onSelectTenant={setSelectedTenantId}
              selected={item.tenant.id === selectedTenantId}
            />
          ))}
        </div>
      </section>

      <OwnerReportRunnerPanel
        busy={busy}
        dateFrom={reportDateFrom}
        dateTo={reportDateTo}
        lastRun={lastManualRun}
        lastSnapshot={lastManualSnapshot}
        onDateFromChange={setReportDateFrom}
        onDateToChange={setReportDateTo}
        onRun={onRunSalesReport}
        onSaveValidationSignoff={onSaveValidationSignoff}
        selectedTenant={selectedTenantSummary}
        selectedTenantId={selectedTenantId}
        setSelectedTenantId={setSelectedTenantId}
        setValidationNote={setValidationNote}
        setValidationReferenceTotal={setValidationReferenceTotal}
        setValidationSignedBy={setValidationSignedBy}
        tenants={tenants}
        validationNote={validationNote}
        validationReferenceTotal={validationReferenceTotal}
        validationSignedBy={validationSignedBy}
        validationSignoffResult={validationSignoffResult}
      />
    </div>
  );
}

function OwnerLineContent({
  busy,
  createLineChannel,
  lineAccessTokenInput,
  lineChannelName,
  lineChannelSecretInput,
  lineSecretConfigured,
  lineSecretChannelId,
  lineTokenConfigured,
  onApproveLineTarget,
  onSaveLineChannelSecrets,
  onSetLineTargetProfile,
  onTestLineTarget,
  onToggleLineTarget,
  publicOrigin,
  selectedTenant,
  selectedTenantId,
  selectedTenantLineChannels,
  selectedTenantLineTargets,
  setLineAccessTokenInput,
  setLineChannelName,
  setLineChannelSecretInput,
  setLineSecretChannelId,
  setLineSecretConfigured,
  setLineTokenConfigured,
  setSelectedTenantId,
  tenants,
}: OwnerSectionContentProps) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className="space-y-4">
        <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
          <OwnerPanelHeader
            title="LINE OA และกลุ่มรับรายงาน"
            description="รวมสถานะ LINE ต่อร้าน เลือกร้านแล้วจัดการกลุ่มรับ Morning Brief ได้จากหน้านี้"
          />
          <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
            {tenants.map((item) => (
              <LineTenantRow
                item={item}
                key={item.tenant.id}
                onSelectTenant={setSelectedTenantId}
                selected={item.tenant.id === selectedTenantId}
              />
            ))}
          </div>
        </section>

        <OwnerLineTargetsPanel
          busy={busy}
          onApprove={onApproveLineTarget}
          onSetProfile={onSetLineTargetProfile}
          onTestSend={onTestLineTarget}
          onToggleEnabled={onToggleLineTarget}
          targets={selectedTenantLineTargets}
          tenantName={selectedTenant?.name ?? "ร้านที่เลือก"}
        />
      </div>

      <div className="space-y-4">
        <LineOnboardingGuide
          publicOrigin={publicOrigin}
          tenantName={selectedTenant?.name ?? "ร้านที่เลือก"}
        />
        <LineChannelPanel
          busy={busy}
          createLineChannel={createLineChannel}
          lineAccessTokenInput={lineAccessTokenInput}
          lineChannelName={lineChannelName}
          lineChannelSecretInput={lineChannelSecretInput}
          lineSecretChannelId={lineSecretChannelId}
          lineSecretConfigured={lineSecretConfigured}
          lineTokenConfigured={lineTokenConfigured}
          onSaveLineChannelSecrets={onSaveLineChannelSecrets}
          selectedTenant={selectedTenant}
          selectedTenantId={selectedTenantId}
          selectedTenantLineChannels={selectedTenantLineChannels}
          setLineAccessTokenInput={setLineAccessTokenInput}
          setLineChannelName={setLineChannelName}
          setLineChannelSecretInput={setLineChannelSecretInput}
          setLineSecretChannelId={setLineSecretChannelId}
          setLineSecretConfigured={setLineSecretConfigured}
          setLineTokenConfigured={setLineTokenConfigured}
          setSelectedTenantId={setSelectedTenantId}
          tenants={tenants}
        />
      </div>
    </div>
  );
}

function OwnerAuditContent({
  operationsStatus,
  tenants,
}: {
  operationsStatus: OwnerOperationsStatus | null;
  tenants: TenantSummary[];
}) {
  return (
    <div className="space-y-4">
      <OperationsStatusPanel operationsStatus={operationsStatus} />

      <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
        <OwnerPanelHeader
          title="ประวัติระบบล่าสุด"
          description="มุมมอง audit แบบ owner: รอบรายงานและการส่ง LINE ล่าสุดต่อร้าน"
          actionHref="/command-center#run-history"
          actionLabel="เปิด run history"
        />
        <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
          {tenants.map((item) => (
            <AuditTenantRow item={item} key={item.tenant.id} />
          ))}
        </div>
      </section>

      <AuditLogPanel auditLogs={operationsStatus?.audit_logs ?? []} />
    </div>
  );
}

function OperationsStatusPanel({
  operationsStatus,
}: {
  operationsStatus: OwnerOperationsStatus | null;
}) {
  if (!operationsStatus) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
        ยังโหลด monitoring status ไม่สำเร็จ กดรีเฟรชอีกครั้งหรือตรวจ API owner token
      </section>
    );
  }

  const workerTone =
    operationsStatus.worker.status === "ok"
      ? "success"
      : operationsStatus.worker.status === "missing"
        ? "warning"
        : "warning";
  const backupTone = operationsStatus.backup.configured ? "success" : "warning";

  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <OwnerPanelHeader
        title="Monitoring / Backup readiness"
        description="ดูสถานะ API, worker, scheduler และแผน backup ในหน้าเดียว ก่อนเรียกว่าพร้อม production"
      />
      <div className="grid gap-3 border-t border-gray-100 p-4 dark:border-gray-800 md:grid-cols-2 xl:grid-cols-4">
        <HealthFact
          label="System store"
          value={
            operationsStatus.api.system_store === "postgres"
              ? "PostgreSQL"
              : "Local JSON"
          }
        />
        <HealthFact
          label="Scheduler"
          value={
            operationsStatus.scheduler.enabled
              ? `${operationsStatus.scheduler.time} ${operationsStatus.scheduler.timezone}`
              : "ปิดอยู่"
          }
        />
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-xs text-gray-500 dark:text-gray-400">Worker</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {formatWorkerStatus(operationsStatus.worker.status)}
            </span>
            <Badge color={workerTone}>{operationsStatus.worker.age_seconds ?? "-"}s</Badge>
          </div>
        </div>
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-xs text-gray-500 dark:text-gray-400">Backup</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {operationsStatus.backup.configured ? "ตั้งค่าแล้ว" : "ยังต้องตั้ง"}
            </span>
            <Badge color={backupTone}>
              {operationsStatus.backup.last_backup_at
                ? formatDateTime(operationsStatus.backup.last_backup_at)
                : "ไม่มีเวลา backup"}
            </Badge>
          </div>
        </div>
      </div>
      {!operationsStatus.backup.configured ? (
        <p className="border-t border-warning-100 bg-warning-50 px-4 py-3 text-sm leading-6 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300">
          {operationsStatus.backup.recommendation}
        </p>
      ) : null}
    </section>
  );
}

function AuditLogPanel({ auditLogs }: { auditLogs: OwnerAuditLogEntry[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      <OwnerPanelHeader
        title="Audit log ล่าสุด"
        description="หลักฐานการรันรายงาน การส่ง LINE การอนุมัติกลุ่ม และการรับรองยอด"
      />
      <div className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-800 dark:border-gray-800">
        {auditLogs.length ? (
          auditLogs.slice(0, 12).map((entry) => (
            <div
              className="grid gap-3 p-4 lg:grid-cols-[180px_minmax(0,1fr)_170px]"
              key={`${entry.id ?? entry.created_at}-${entry.action}-${entry.target_id ?? ""}`}
            >
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {formatAuditAction(entry.action)}
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {formatDateTime(entry.created_at)}
                </p>
              </div>
              <div className="min-w-0 text-sm leading-6 text-gray-600 dark:text-gray-400">
                <p className="truncate">
                  tenant: {entry.tenant_id ?? "-"} · {entry.target_type}:{" "}
                  {entry.target_id ?? "-"}
                </p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-500">
                  {formatAuditMetadata(entry.metadata_json)}
                </p>
              </div>
              <Badge color={auditActionTone(entry.action)}>
                {entry.action}
              </Badge>
            </div>
          ))
        ) : (
          <p className="p-5 text-sm text-gray-500 dark:text-gray-400">
            ยังไม่มี audit log ล่าสุดให้แสดง
          </p>
        )}
      </div>
    </section>
  );
}

function OwnerReportRunnerPanel({
  busy,
  dateFrom,
  dateTo,
  lastRun,
  lastSnapshot,
  onDateFromChange,
  onDateToChange,
  onRun,
  onSaveValidationSignoff,
  selectedTenant,
  selectedTenantId,
  setSelectedTenantId,
  setValidationNote,
  setValidationReferenceTotal,
  setValidationSignedBy,
  tenants,
  validationNote,
  validationReferenceTotal,
  validationSignedBy,
  validationSignoffResult,
}: {
  busy: string | null;
  dateFrom: string;
  dateTo: string;
  lastRun: ReportRunRecord | null;
  lastSnapshot: SalesGoodsServicesSnapshot | null;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onRun: () => Promise<void>;
  onSaveValidationSignoff: () => Promise<void>;
  selectedTenant?: TenantSummary;
  selectedTenantId: string;
  setSelectedTenantId: (value: string) => void;
  setValidationNote: (value: string) => void;
  setValidationReferenceTotal: (value: string) => void;
  setValidationSignedBy: (value: string) => void;
  tenants: TenantSummary[];
  validationNote: string;
  validationReferenceTotal: string;
  validationSignedBy: string;
  validationSignoffResult: ValidationSignoffResult | null;
}) {
  const isRunning = busy === `report-run-${selectedTenantId}`;
  const selectedSnapshotMatches =
    lastSnapshot?.tenant_id === selectedTenantId &&
    lastSnapshot.params.date_from === dateFrom &&
    lastSnapshot.params.date_to === dateTo;

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">
            Manual report run
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
            รันรายงานแบบผู้ดูแล
          </h2>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            ใช้ approved SQL เดียวกับ dashboard/LINE และบันทึก snapshot ที่ trace ได้
          </p>
        </div>
        <Badge color={selectedTenant?.access.enabled ? "success" : "warning"}>
          {selectedTenant?.access.enabled ? "พร้อมรัน" : "ควรตรวจสถานะร้าน"}
        </Badge>
      </div>

      <div className="mt-5 space-y-4 border-t border-gray-100 pt-5 dark:border-gray-800">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ร้านค้า
          <select
            className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            onChange={(event) => setSelectedTenantId(event.target.value)}
            value={selectedTenantId}
          >
            {tenants.map((item) => (
              <option key={item.tenant.id} value={item.tenant.id}>
                {item.tenant.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            จากวันที่
            <input
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
              onChange={(event) => onDateFromChange(event.target.value)}
              type="date"
              value={dateFrom}
            />
          </label>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            ถึงวันที่
            <input
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
              onChange={(event) => onDateToChange(event.target.value)}
              type="date"
              value={dateTo}
            />
          </label>
        </div>

        <Button
          className="w-full"
          disabled={isRunning || !selectedTenantId}
          onClick={() => void onRun()}
          size="sm"
        >
          {isRunning ? "กำลังรันรายงาน..." : "รันรายงาน"}
        </Button>

        <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
          <p className="text-xs font-semibold uppercase text-gray-400">
            Snapshot ล่าสุดของร้านที่เลือก
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <HealthFact
              label="รายงานล่าสุด"
              value={
                selectedTenant?.health.latest_snapshot_at
                  ? formatDateTime(selectedTenant.health.latest_snapshot_at)
                  : "ยังไม่มี"
              }
            />
            <HealthFact
              label="สถานะล่าสุด"
              value={formatRunStatus(selectedTenant?.health.latest_report_status ?? null)}
            />
          </div>
        </div>

        {lastRun ? (
          <div
            className={`rounded-xl border p-3 text-sm ${
              lastRun.status === "success"
                ? "border-success-100 bg-success-50 text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-300"
                : "border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300"
            }`}
          >
            <p className="font-semibold">ผลรันล่าสุดในหน้านี้</p>
            <p className="mt-1 text-xs leading-5">
              {formatRunStatus(lastRun.status)} ·{" "}
              {formatReportPeriod(lastRun.params.date_from, lastRun.params.date_to)}
              {lastRun.safe_error_message ? ` · ${lastRun.safe_error_message}` : ""}
            </p>
          </div>
        ) : null}

        {selectedSnapshotMatches && lastSnapshot ? (
          <dl className="grid gap-2 sm:grid-cols-2">
            <HealthFact
              label="ยอดขายสุทธิ"
              value={formatCurrency(lastSnapshot.summary.total_sales)}
            />
            <HealthFact
              label="บิลขาย"
              value={`${lastSnapshot.summary.document_count.toLocaleString("th-TH")} ใบ`}
            />
            <HealthFact
              label="รายการขาย"
              value={`${lastSnapshot.summary.line_count.toLocaleString("th-TH")} รายการ`}
            />
            <HealthFact
              label="Trust"
              value={formatQualityStatus(lastSnapshot.quality_status)}
            />
          </dl>
        ) : (
          <p className="rounded-xl border border-dashed border-gray-200 p-3 text-xs leading-5 text-gray-500 dark:border-gray-800 dark:text-gray-400">
            หลังรันสำเร็จ ระบบจะแสดงยอดขายและจำนวนบิลของช่วงวันที่นี้ตรงนี้ทันที
          </p>
        )}

        <ValidationSignoffPanel
          busy={busy === `validation-signoff-${selectedTenantId}`}
          dateFrom={dateFrom}
          dateTo={dateTo}
          lastSnapshot={selectedSnapshotMatches ? lastSnapshot : null}
          onSave={onSaveValidationSignoff}
          referenceTotal={validationReferenceTotal}
          result={validationSignoffResult}
          signedBy={validationSignedBy}
          note={validationNote}
          setNote={setValidationNote}
          setReferenceTotal={setValidationReferenceTotal}
          setSignedBy={setValidationSignedBy}
        />
      </div>
    </section>
  );
}

function ValidationSignoffPanel({
  busy,
  dateFrom,
  dateTo,
  lastSnapshot,
  note,
  onSave,
  referenceTotal,
  result,
  signedBy,
  setNote,
  setReferenceTotal,
  setSignedBy,
}: {
  busy: boolean;
  dateFrom: string;
  dateTo: string;
  lastSnapshot: SalesGoodsServicesSnapshot | null;
  note: string;
  onSave: () => Promise<void>;
  referenceTotal: string;
  result: ValidationSignoffResult | null;
  signedBy: string;
  setNote: (value: string) => void;
  setReferenceTotal: (value: string) => void;
  setSignedBy: (value: string) => void;
}) {
  const systemTotal = lastSnapshot?.summary.total_sales ?? null;
  const referenceValue = Number(referenceTotal);
  const hasReference = Number.isFinite(referenceValue);
  const difference =
    systemTotal !== null && hasReference
      ? Math.round((systemTotal - referenceValue + Number.EPSILON) * 100) / 100
      : null;
  const isAccepted = difference !== null && Math.abs(difference) <= 0.01;

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">
            Validation sign-off
          </p>
          <h3 className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            รับรองยอดเทียบกับรายงาน SML เดิม
          </h3>
          <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
            ใช้เป็นหลักฐาน pilot ว่าลูกค้า/owner ตรวจยอดแล้ว ก่อนเปิดใช้รายเดือน
          </p>
        </div>
        <Badge color={isAccepted ? "success" : result ? "warning" : "light"}>
          {isAccepted ? "ยอดตรง" : result ? "มีส่วนต่าง" : "รอรับรอง"}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <HealthFact
          label="ยอดจาก AI Business"
          value={
            systemTotal !== null
              ? `${formatCurrency(systemTotal)} บาท`
              : "รันรายงานก่อน"
          }
        />
        <HealthFact
          label="ช่วงวันที่"
          value={formatReportPeriod(dateFrom, dateTo)}
        />
      </div>

      <div className="mt-3 grid gap-3">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ยอดจากรายงาน SML เดิม
          <input
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            inputMode="decimal"
            onChange={(event) => setReferenceTotal(event.target.value)}
            placeholder="เช่น 87106503.67"
            value={referenceTotal}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          ผู้ตรวจ/ผู้รับรองยอด
          <input
            className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            onChange={(event) => setSignedBy(event.target.value)}
            placeholder="ชื่อผู้ตรวจ หรือชื่อลูกค้าที่รับรอง"
            value={signedBy}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          หมายเหตุ
          <textarea
            className="mt-1 min-h-20 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            onChange={(event) => setNote(event.target.value)}
            placeholder="เช่น เทียบกับรายงานขายสินค้าและบริการเดิมแล้ว"
            value={note}
          />
        </label>
      </div>

      {difference !== null ? (
        <p
          className={`mt-3 rounded-lg border p-3 text-sm ${
            isAccepted
              ? "border-success-100 bg-success-50 text-success-700 dark:border-success-500/20 dark:bg-success-500/10 dark:text-success-300"
              : "border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-500/20 dark:bg-warning-500/10 dark:text-warning-300"
          }`}
        >
          {isAccepted
            ? "ยอดตรงตามรายงาน SML เดิม สามารถบันทึกการรับรองได้"
            : `พบส่วนต่าง ${formatCurrency(difference)} บาท ควรตรวจช่วงวันที่หรือเงื่อนไขรายงานก่อนเซ็นรับ`}
        </p>
      ) : null}

      <Button
        className="mt-3 w-full"
        disabled={busy || !lastSnapshot}
        onClick={() => void onSave()}
        size="sm"
        variant={isAccepted ? "primary" : "outline"}
      >
        {busy ? "กำลังบันทึก..." : "บันทึกการรับรองยอด"}
      </Button>
    </div>
  );
}

function ReportTenantRow({
  item,
  onSelectTenant,
  selected,
}: {
  item: TenantSummary;
  onSelectTenant: (tenantId: string) => void;
  selected: boolean;
}) {
  return (
    <div
      className={`grid gap-3 p-4 lg:grid-cols-[minmax(180px,1fr)_140px_170px_110px] lg:items-center ${
        selected ? "bg-brand-50/40 dark:bg-brand-500/[0.08]" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 dark:text-white">
          {item.tenant.name}
        </p>
        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
          sales_goods_services · ฐาน {item.tenant.databaseName || "-"}
        </p>
      </div>
      <CompactFact
        label="สถานะรัน"
        value={formatRunStatus(item.health.latest_report_status)}
      />
      <CompactFact
        label="Snapshot ล่าสุด"
        value={
          item.health.latest_snapshot_at
            ? formatDateTime(item.health.latest_snapshot_at)
            : "ยังไม่มี"
        }
      />
      <div className="flex gap-2 lg:justify-end">
        <Button
          disabled={selected}
          size="sm"
          variant="outline"
          onClick={() => onSelectTenant(item.tenant.id)}
        >
          {selected ? "เลือกอยู่" : "จัดการ"}
        </Button>
      </div>
    </div>
  );
}

function LineTenantRow({
  item,
  onSelectTenant,
  selected,
}: {
  item: TenantSummary;
  onSelectTenant: (tenantId: string) => void;
  selected: boolean;
}) {
  const lineReady =
    item.health.line_channels > 0 && item.health.line_targets_enabled > 0;
  return (
    <div
      className={`grid gap-3 p-4 lg:grid-cols-[minmax(180px,1fr)_120px_130px_140px_110px] lg:items-center ${
        selected ? "bg-brand-50/40 dark:bg-brand-500/[0.08]" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-gray-900 dark:text-white">
            {item.tenant.name}
          </p>
          <Badge color={lineReady ? "success" : "warning"}>
            {lineReady ? "พร้อมส่ง" : "ต้องตั้งค่า"}
          </Badge>
        </div>
        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
          Morning Brief · {item.tenant.id}
        </p>
      </div>
      <CompactFact
        label="LINE OA"
        value={`${item.health.line_channels} ช่องทาง`}
      />
      <CompactFact
        label="กลุ่มที่เปิดรับ"
        value={`${item.health.line_targets_enabled}/${item.health.line_targets_total} กลุ่ม`}
      />
      <CompactFact
        label="ส่งล่าสุด"
        value={
          item.health.latest_line_delivery_at
            ? formatDateTime(item.health.latest_line_delivery_at)
            : "ยังไม่มี"
        }
      />
      <div className="flex lg:justify-end">
        <Button
          disabled={selected}
          size="sm"
          variant="outline"
          onClick={() => onSelectTenant(item.tenant.id)}
        >
          {selected ? "เลือกอยู่" : "จัดการ"}
        </Button>
      </div>
    </div>
  );
}

function AuditTenantRow({ item }: { item: TenantSummary }) {
  return (
    <div className="grid gap-3 p-4 lg:grid-cols-[minmax(180px,1fr)_170px_170px_140px] lg:items-center">
      <div className="min-w-0">
        <p className="font-semibold text-gray-900 dark:text-white">
          {item.tenant.name}
        </p>
        <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
          {item.tenant.id}
        </p>
      </div>
      <CompactFact
        label="รันรายงานล่าสุด"
        value={
          item.health.latest_report_run_at
            ? formatDateTime(item.health.latest_report_run_at)
            : "ยังไม่มี"
        }
      />
      <CompactFact
        label="ส่ง LINE ล่าสุด"
        value={
          item.health.latest_line_delivery_at
            ? formatDateTime(item.health.latest_line_delivery_at)
            : "ยังไม่มี"
        }
      />
      <Badge color={item.health.latest_line_delivery_status === "success" ? "success" : "light"}>
        {formatLineDeliveryStatus(item.health.latest_line_delivery_status)}
      </Badge>
    </div>
  );
}

function buildOwnerActionItems(tenants: TenantSummary[]) {
  return tenants.flatMap((item) => {
    const actions: Array<{
      description: string;
      label: "ต้องทำ" | "ตรวจ";
      tenantName: string;
      title: string;
      tone: "warning" | "error";
    }> = [];

    if (!item.access.enabled) {
      actions.push({
        description: item.access.message,
        label: "ต้องทำ",
        tenantName: item.tenant.name,
        title: "บัญชีร้านถูกบล็อก",
        tone: "error",
      });
    }
    if (!item.health.datasource_configured) {
      actions.push({
        description: "ยังไม่มี datasource config สำหรับ SML",
        label: "ต้องทำ",
        tenantName: item.tenant.name,
        title: "เชื่อม SML datasource",
        tone: "warning",
      });
    }
    if (!item.health.latest_snapshot_at) {
      actions.push({
        description: "ลูกค้ายังไม่มี snapshot ล่าสุดให้ดู",
        label: "ต้องทำ",
        tenantName: item.tenant.name,
        title: "รันรายงานแรก",
        tone: "warning",
      });
    }
    if (item.health.line_channels === 0) {
      actions.push({
        description: "ยังไม่มี LINE OA metadata สำหรับร้านนี้",
        label: "ต้องทำ",
        tenantName: item.tenant.name,
        title: "เพิ่ม LINE OA",
        tone: "warning",
      });
    }
    if (item.health.line_channels > 0 && item.health.line_targets_enabled === 0) {
      actions.push({
        description: "มี LINE OA แล้ว แต่ยังไม่มีกลุ่มที่อนุมัติรับ Morning Brief",
        label: "ตรวจ",
        tenantName: item.tenant.name,
        title: "อนุมัติกลุ่ม LINE",
        tone: "warning",
      });
    }

    return actions;
  });
}

function formatRunStatus(status: string | null) {
  if (status === "success") {
    return "สำเร็จ";
  }
  if (status === "failed") {
    return "ล้มเหลว";
  }
  if (status === "running") {
    return "กำลังรัน";
  }
  return "ยังไม่มี";
}

function formatWorkerStatus(status: string) {
  if (status === "ok") {
    return "ปกติ";
  }
  if (status === "stale") {
    return "heartbeat เก่า";
  }
  if (status === "missing") {
    return "ยังไม่พบ heartbeat";
  }
  if (status === "warning") {
    return "ควรตรวจ";
  }
  if (status === "error") {
    return "ผิดพลาด";
  }
  return status;
}

function formatAuditAction(action: string) {
  const labels: Record<string, string> = {
    datasource_test_succeeded: "ทดสอบ SML สำเร็จ",
    datasource_test_failed: "ทดสอบ SML ไม่สำเร็จ",
    line_target_approved: "อนุมัติกลุ่ม LINE",
    line_target_updated: "แก้สิทธิ์กลุ่ม LINE",
    line_delivery_succeeded: "ส่ง LINE สำเร็จ",
    line_delivery_failed: "ส่ง LINE ไม่สำเร็จ",
    morning_brief_report_run_requested: "รัน Morning Brief",
    report_run_requested: "รันรายงาน",
    report_run_succeeded: "รันรายงานสำเร็จ",
    report_run_failed: "รันรายงานไม่สำเร็จ",
    report_validation_signed_off: "รับรองยอดรายงาน",
    owner_tenant_created: "เพิ่มร้านค้า",
    owner_tenant_updated: "แก้ไขร้านค้า",
  };
  return labels[action] ?? action;
}

function auditActionTone(action: string): "success" | "warning" | "error" | "light" {
  if (action.includes("failed")) {
    return "error";
  }
  if (action.includes("signed_off") || action.includes("succeeded")) {
    return "success";
  }
  if (action.includes("updated") || action.includes("requested")) {
    return "warning";
  }
  return "light";
}

function formatAuditMetadata(metadata: Record<string, unknown>) {
  const keys = [
    "safe_error_message",
    "date_from",
    "date_to",
    "difference_amount",
    "accepted",
    "access_profile_key",
    "enabled",
  ];
  const parts = keys
    .filter((key) => metadata[key] !== undefined && metadata[key] !== null)
    .map((key) => `${key}: ${String(metadata[key])}`);
  return parts.length ? parts.join(" · ") : "ไม่มี metadata เพิ่มเติม";
}

function OwnerSetupPanel({
  busy,
  createTenant,
  newTenantId,
  newTenantName,
  setNewTenantId,
  setNewTenantName,
}: {
  busy: string | null;
  createTenant: (event: FormEvent<HTMLFormElement>) => void;
  newTenantId: string;
  newTenantName: string;
  setNewTenantId: (value: string) => void;
  setNewTenantName: (value: string) => void;
}) {
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              ตั้งค่าเพิ่มเติม
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              เพิ่มร้านใหม่เมื่อเริ่ม pilot ลูกค้ารายถัดไป ส่วน flow หลักคือเลือก tenant ด้านล่างแล้วจัดการต่อ
            </p>
          </div>
          <Badge color="light">คลิกเพื่อเปิด</Badge>
        </div>
      </summary>

      <form
        className="mt-5 border-t border-gray-100 pt-5 dark:border-gray-800"
        onSubmit={createTenant}
      >
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
          เพิ่มร้านค้าใหม่
        </h3>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input
            className="h-11 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
            onChange={(event) => setNewTenantName(event.target.value)}
            placeholder="ชื่อร้านค้า"
            value={newTenantName}
          />
          <input
            className="h-11 rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
            onChange={(event) => setNewTenantId(event.target.value)}
            placeholder="tenant_id เช่น tenant_demo_remote"
            value={newTenantId}
          />
          <Button disabled={busy === "create"} size="sm">
            เพิ่มร้านค้า
          </Button>
        </div>
      </form>
    </details>
  );
}

function LineChannelPanel({
  busy,
  createLineChannel,
  lineAccessTokenInput,
  lineChannelName,
  lineChannelSecretInput,
  lineSecretChannelId,
  lineSecretConfigured,
  lineTokenConfigured,
  onSaveLineChannelSecrets,
  selectedTenant,
  selectedTenantId,
  selectedTenantLineChannels,
  setLineAccessTokenInput,
  setLineChannelName,
  setLineChannelSecretInput,
  setLineSecretChannelId,
  setLineSecretConfigured,
  setLineTokenConfigured,
  setSelectedTenantId,
  tenants,
}: {
  busy: string | null;
  createLineChannel: (event: FormEvent<HTMLFormElement>) => void;
  lineAccessTokenInput: string;
  lineChannelName: string;
  lineChannelSecretInput: string;
  lineSecretChannelId: string;
  lineSecretConfigured: boolean;
  lineTokenConfigured: boolean;
  onSaveLineChannelSecrets: (event: FormEvent<HTMLFormElement>) => void;
  selectedTenant?: Tenant;
  selectedTenantId: string;
  selectedTenantLineChannels: LineChannelRecord[];
  setLineAccessTokenInput: (value: string) => void;
  setLineChannelName: (value: string) => void;
  setLineChannelSecretInput: (value: string) => void;
  setLineSecretChannelId: (value: string) => void;
  setLineSecretConfigured: (value: boolean) => void;
  setLineTokenConfigured: (value: boolean) => void;
  setSelectedTenantId: (value: string) => void;
  tenants: TenantSummary[];
}) {
  return (
    <details className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              LINE OA ของร้าน
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              เพิ่ม LINE OA metadata เมื่อพร้อมผูกช่องทางจริง
            </p>
          </div>
          <Badge color="light">
            {selectedTenantLineChannels.length} ช่องทาง
          </Badge>
        </div>
      </summary>

      <form
        className="mt-5 border-t border-gray-100 pt-5 dark:border-gray-800"
        onSubmit={createLineChannel}
      >
        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            ร้านค้า
            <select
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setSelectedTenantId(event.target.value)}
              value={selectedTenantId}
            >
              {tenants.map((item) => (
                <option key={item.tenant.id} value={item.tenant.id}>
                  {item.tenant.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            ชื่อ LINE OA
            <input
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
              onChange={(event) => setLineChannelName(event.target.value)}
              placeholder="เช่น AI Business Center Demo"
              value={lineChannelName}
            />
          </label>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <input
                checked={lineTokenConfigured}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) =>
                  setLineTokenConfigured(event.target.checked)
                }
                type="checkbox"
              />
              <span>มี Channel access token แล้ว</span>
            </label>
            <label className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.02] dark:text-gray-400">
              <input
                checked={lineSecretConfigured}
                className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500"
                onChange={(event) =>
                  setLineSecretConfigured(event.target.checked)
                }
                type="checkbox"
              />
              <span>มี Channel secret สำหรับ webhook แล้ว</span>
            </label>
          </div>

          <Button disabled={busy === "create-line-channel"} size="sm">
            เพิ่ม LINE OA
          </Button>
        </div>
      </form>

      <form
        className="mt-5 border-t border-gray-100 pt-5 dark:border-gray-800"
        onSubmit={onSaveLineChannelSecrets}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              บันทึก token/secret แบบเข้ารหัส
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              ใช้เมื่อสร้าง LINE OA แล้ว ต้องการให้ระบบส่ง Morning Brief และรับ
              webhook ของช่องทางนี้
            </p>
          </div>
          <Badge color="light">masked</Badge>
        </div>

        <div className="mt-3 space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            เลือก LINE OA
            <select
              className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              onChange={(event) => setLineSecretChannelId(event.target.value)}
              value={lineSecretChannelId}
            >
              {selectedTenantLineChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.display_name}
                </option>
              ))}
            </select>
          </label>
          <OwnerTextInput
            label="Channel access token"
            onChange={setLineAccessTokenInput}
            placeholder="ใส่ token ใหม่เฉพาะตอนตั้งค่าหรือเปลี่ยน token"
            type="password"
            value={lineAccessTokenInput}
          />
          <OwnerTextInput
            label="Channel secret"
            onChange={setLineChannelSecretInput}
            placeholder="ใส่ secret ใหม่เฉพาะตอนตั้งค่าหรือเปลี่ยน secret"
            type="password"
            value={lineChannelSecretInput}
          />
          <Button
            disabled={
              busy === `line-secrets-${lineSecretChannelId}` ||
              !lineSecretChannelId ||
              (!lineAccessTokenInput.trim() && !lineChannelSecretInput.trim())
            }
            size="sm"
          >
            {busy === `line-secrets-${lineSecretChannelId}`
              ? "กำลังบันทึก..."
              : "บันทึก LINE secret"}
          </Button>
        </div>
      </form>

      <div className="mt-5 border-t border-gray-100 pt-4 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase text-gray-400">
          LINE OA ที่ผูกกับ {selectedTenant?.name ?? "ร้านนี้"}
        </p>
        <div className="mt-3 space-y-2">
          {selectedTenantLineChannels.length ? (
            selectedTenantLineChannels.map((channel) => (
              <div
                className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
                key={channel.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">
                    {channel.display_name}
                  </p>
                  <Badge color={channel.enabled ? "success" : "warning"}>
                    {channel.enabled ? "เปิดใช้" : "ปิด"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  token:{" "}
                  {channel.channel_access_token_configured ? "มี" : "ยังไม่มี"}{" "}
                  · secret:{" "}
                  {channel.channel_secret_configured ? "มี" : "ยังไม่มี"} ·
                  source: {channel.source}
                </p>
              </div>
            ))
          ) : (
            <p className="rounded-lg border border-dashed border-gray-200 p-4 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
              ยังไม่มี LINE OA สำหรับร้านนี้
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

function DatasourceConfigPanel({
  busy,
  config,
  database,
  host,
  onDatabaseChange,
  onHostChange,
  onPasswordChange,
  onPortChange,
  onSubmit,
  onUserChange,
  password,
  port,
  user,
}: {
  busy: boolean;
  config: DatasourceConfigStatus | null;
  database: string;
  host: string;
  onDatabaseChange: (value: string) => void;
  onHostChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPortChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUserChange: (value: string) => void;
  password: string;
  port: string;
  user: string;
}) {
  const sourceLabel =
    config?.source === "encrypted_store"
      ? "บันทึกในระบบแล้ว"
      : config?.source === "env"
        ? "อ่านจาก env server"
        : "ยังไม่ตั้งค่า";

  return (
    <details className="mt-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <summary className="cursor-pointer list-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              ตั้งค่า SML datasource
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              ใส่ host/user/password เพื่อให้ระบบเก็บแบบเข้ารหัส ไม่ต้องแก้ .env
              ทุกครั้ง
            </p>
          </div>
          <Badge color={config?.password_configured ? "success" : "warning"}>
            {sourceLabel}
          </Badge>
        </div>
      </summary>

      <form className="mt-4 space-y-3" onSubmit={onSubmit}>
        {!config?.encryption_configured ? (
          <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-xs leading-5 text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
            Server ยังไม่ได้ตั้ง AI_BCC_SECRET_KEY จึงยังบันทึก password/token
            แบบเข้ารหัสไม่ได้
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px]">
          <OwnerTextInput
            label="Host"
            onChange={onHostChange}
            placeholder="demserver.3bbddns.com"
            value={host}
          />
          <OwnerTextInput
            label="Port"
            onChange={onPortChange}
            placeholder="5432"
            value={port}
          />
        </div>
        <OwnerTextInput
          label="Database"
          onChange={onDatabaseChange}
          placeholder="demo"
          value={database}
        />
        <OwnerTextInput
          label="User"
          onChange={onUserChange}
          placeholder="sml_readonly"
          value={user}
        />
        <OwnerTextInput
          label="Password"
          onChange={onPasswordChange}
          placeholder={
            config?.password_configured
              ? "ใส่ใหม่เฉพาะเมื่อต้องการเปลี่ยน password"
              : "ใส่ password ของ DB"
          }
          type="password"
          value={password}
        />

        <div className="flex flex-col gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>
            สถานะปัจจุบัน: {sourceLabel}
            {config?.updated_at ? ` · ${formatDateTime(config.updated_at)}` : ""}
          </span>
          <span>
            Audit จะเก็บ host/database/user เท่านั้น ไม่เก็บ password แบบอ่านได้
          </span>
        </div>

        <Button
          disabled={busy || !config?.encryption_configured || !password.trim()}
          size="sm"
        >
          {busy ? "กำลังบันทึก..." : "บันทึก datasource แบบเข้ารหัส"}
        </Button>
      </form>
    </details>
  );
}

function OwnerTextInput({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password";
  value: string;
}) {
  return (
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-800 dark:border-gray-700 dark:text-white"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

function TenantCard({
  item,
  busy,
  selected,
  datasourceTest,
  onSelectTenant,
  onUpdateStatus,
}: {
  item: TenantSummary;
  busy: string | null;
  selected: boolean;
  datasourceTest?: DatasourceTestResult;
  onSelectTenant: (tenantId: string) => void;
  onUpdateStatus: (tenant: Tenant, status: Tenant["status"]) => Promise<void>;
}) {
  const tenant = item.tenant;
  const readiness = getTenantReadiness(item, datasourceTest);
  return (
    <div
      className={`bg-white p-4 transition-colors dark:bg-white/[0.02] ${
        selected
          ? "bg-brand-50/40 dark:bg-brand-500/[0.08]"
          : "hover:bg-gray-50 dark:hover:bg-white/[0.04]"
      }`}
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">
              {tenant.name}
            </h3>
            <Badge color={tenantStatusTone(tenant.status)}>
              {formatTenantStatus(tenant.status)}
            </Badge>
            <Badge color="light">{tenant.planCode}</Badge>
            <Badge color={readiness.tone}>
              {readiness.label}
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {tenant.id} · ฐานข้อมูล {tenant.databaseName || "ยังไม่ตั้งค่า"}
          </p>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {item.access.message}
          </p>

          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 2xl:grid-cols-4">
            <CompactFact
              label="SML"
              value={
                datasourceTest
                  ? datasourceTest.ok
                    ? "ทดสอบผ่าน"
                    : "ต้องตรวจ"
                  : item.health.datasource_configured
                    ? "พร้อม"
                    : "ยังไม่พร้อม"
              }
            />
            <CompactFact
              label="LINE"
              value={`${item.health.line_channels} OA · ${item.health.line_targets_enabled}/${item.health.line_targets_total} กลุ่ม`}
            />
            <CompactFact
              label="รายงานล่าสุด"
              value={
                item.health.latest_snapshot_at
                  ? formatDateTime(item.health.latest_snapshot_at)
                  : "ยังไม่มี"
              }
            />
            <CompactFact label="Dashboard" value={item.customer_dashboard_path ?? "-"} />
          </dl>
        </div>
        <div className="flex flex-wrap gap-2 xl:max-w-[260px] xl:justify-end">
          <Button
            disabled={selected}
            size="sm"
            variant="outline"
            onClick={() => onSelectTenant(tenant.id)}
          >
            {selected ? "เลือกอยู่" : "จัดการ"}
          </Button>
          {item.customer_dashboard_path ? (
            <Link
              className="inline-flex h-9 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 shadow-xs hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              href={item.customer_dashboard_path}
              rel="noreferrer"
              target="_blank"
            >
              Dashboard
            </Link>
          ) : null}
          <Button
            disabled={busy === `${tenant.id}-active`}
            size="sm"
            variant="outline"
            onClick={() => void onUpdateStatus(tenant, "active")}
          >
            เปิด
          </Button>
          <Button
            disabled={busy === `${tenant.id}-suspended`}
            size="sm"
            variant="outline"
            onClick={() => void onUpdateStatus(tenant, "suspended")}
          >
            ระงับ
          </Button>
        </div>
      </div>
    </div>
  );
}

function TenantDetailPanel({
  item,
  busy,
  datasourceConfig,
  datasourceDatabase,
  datasourceHost,
  datasourcePassword,
  datasourcePort,
  datasourceUser,
  datasourceTest,
  onSaveDatasourceConfig,
  onTestDatasource,
  setDatasourceDatabase,
  setDatasourceHost,
  setDatasourcePassword,
  setDatasourcePort,
  setDatasourceUser,
}: {
  item?: TenantSummary;
  busy: string | null;
  datasourceConfig: DatasourceConfigStatus | null;
  datasourceDatabase: string;
  datasourceHost: string;
  datasourcePassword: string;
  datasourcePort: string;
  datasourceUser: string;
  datasourceTest?: DatasourceTestResult;
  onSaveDatasourceConfig: (event: FormEvent<HTMLFormElement>) => void;
  onTestDatasource: (tenantId: string) => Promise<void>;
  setDatasourceDatabase: (value: string) => void;
  setDatasourceHost: (value: string) => void;
  setDatasourcePassword: (value: string) => void;
  setDatasourcePort: (value: string) => void;
  setDatasourceUser: (value: string) => void;
}) {
  if (!item) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-400">
        เลือกร้านค้าเพื่อดูรายละเอียดการตั้งค่า
      </div>
    );
  }

  const tenant = item.tenant;
  const datasourceBusy = busy === `datasource-${tenant.id}`;
  const readiness = getTenantReadiness(item, datasourceTest);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-gray-400">
            ร้านที่กำลังจัดการ
          </p>
          <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
            {tenant.name}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {tenant.id}
          </p>
        </div>
        <Badge color={tenantStatusTone(tenant.status)}>
          {formatTenantStatus(tenant.status)}
        </Badge>
      </div>

      <dl className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100 dark:divide-gray-800 dark:border-gray-800">
        <DetailRow label="แพ็กเกจ" value={tenant.planCode} />
        <DetailRow
          label="Dashboard ลูกค้า"
          value={item.customer_dashboard_path ?? "ยังไม่มี slug"}
        />
        <DetailRow
          label="ฐานข้อมูล SML"
          value={tenant.databaseName || "ยังไม่ระบุ"}
        />
        <DetailRow
          label="สถานะบริการ"
          value={item.access.enabled ? "เปิดใช้งาน" : "ถูกบล็อก"}
        />
      </dl>

      <div className="mt-4 rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <details className="mb-4 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <summary className="cursor-pointer list-none">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Pilot readiness checklist
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                  เปิดดูเฉพาะตอนเตรียม rollout ร้านนี้
                </p>
              </div>
              <Badge color={readiness.tone}>{readiness.label}</Badge>
            </div>
          </summary>
          <div className="mt-3 grid gap-2">
            {readiness.items.map((check) => (
              <ReadinessRow key={check.label} item={check} />
            ))}
          </div>
        </details>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              SML PostgreSQL datasource
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              ตรวจว่า API server เชื่อมฐานข้อมูลได้ และพบตาราง SML ที่รายงานนี้ต้องใช้
            </p>
          </div>
          <Button
            disabled={datasourceBusy}
            size="sm"
            variant="outline"
            onClick={() => void onTestDatasource(tenant.id)}
          >
            {datasourceBusy ? "กำลังทดสอบ..." : "ทดสอบ SML"}
          </Button>
        </div>

        <DatasourceTestSummary result={datasourceTest} />

        <DatasourceConfigPanel
          busy={busy === `datasource-save-${tenant.id}`}
          config={datasourceConfig}
          database={datasourceDatabase}
          host={datasourceHost}
          onDatabaseChange={setDatasourceDatabase}
          onHostChange={setDatasourceHost}
          onPasswordChange={setDatasourcePassword}
          onPortChange={setDatasourcePort}
          onSubmit={onSaveDatasourceConfig}
          password={datasourcePassword}
          port={datasourcePort}
          user={datasourceUser}
          onUserChange={setDatasourceUser}
        />
      </div>
    </div>
  );
}

function LineOnboardingGuide({
  publicOrigin,
  tenantName,
}: {
  publicOrigin: string;
  tenantName: string;
}) {
  const webhookUrl = publicOrigin
    ? `${publicOrigin}/api/line/webhook`
    : "/api/line/webhook";

  return (
    <details className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
      <summary className="cursor-pointer list-none">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-gray-400">
              LINE OA onboarding
            </p>
            <h2 className="mt-1 text-base font-semibold text-gray-900 dark:text-white">
              วิธีให้ {tenantName} เริ่มรับ Morning Brief
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
              ดึง OA เข้ากลุ่ม → พิมพ์ test → owner อนุมัติสิทธิ์
            </p>
          </div>
          <Badge color="light">ไม่ auto-enable กลุ่มใหม่</Badge>
        </div>
      </summary>

      <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Webhook URL สำหรับ trycloudflare รอบนี้
        </p>
        <p className="mt-2 break-all rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 dark:border-gray-800 dark:bg-gray-900 dark:text-white">
          {webhookUrl}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {[
          "เพิ่มหรือเลือก LINE OA ของร้านใน LINE Developers",
          "ตั้ง Webhook URL และเปิด Use webhook",
          "ให้ลูกค้าดึง OA เข้ากลุ่ม LINE ที่ต้องการรับรายงาน",
          "ให้ลูกค้าพิมพ์ test ในกลุ่ม เพื่อให้ระบบ discover target",
          "กลับมาหน้า LINE OA/สิทธิ์กลุ่ม แล้วอนุมัติ profile เช่น ผู้บริหาร หรือฝ่ายขาย",
          "กดส่งทดสอบเฉพาะกลุ่มก่อนเปิด Morning Brief ประจำวัน",
        ].map((step, index) => (
          <div
            className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]"
            key={step}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
              {index + 1}
            </span>
            <p className="text-sm leading-6 text-gray-700 dark:text-gray-300">
              {step}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function DatasourceTestSummary({
  result,
}: {
  result?: DatasourceTestResult;
}) {
  if (!result) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
        ยังไม่ได้ทดสอบในรอบนี้ กด “ทดสอบ SML” เพื่อเช็ค connection จริงจาก server
      </p>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge color={result.ok ? "success" : "warning"}>
          {result.ok ? "เชื่อมต่อได้" : "ควรตรวจสอบ"}
        </Badge>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          ตรวจล่าสุด {formatDateTime(result.checked_at)} · {result.latency_ms} ms
        </span>
      </div>
      {result.safe_error_message ? (
        <p className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-500/30 dark:bg-warning-500/10 dark:text-warning-300">
          {toDatasourceBusinessMessage(result.safe_error_message)}
        </p>
      ) : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <HealthFact
          label="Database"
          value={result.database_name ?? "ไม่ทราบชื่อ"}
        />
        <HealthFact
          label="DB user"
          value={result.user_name_masked ?? "ไม่เปิดเผย"}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {Object.entries(result.required_tables).map(([table, ok]) => (
          <div
            className="rounded-lg border border-gray-100 bg-white p-3 text-sm dark:border-gray-800 dark:bg-gray-900"
            key={table}
          >
            <p className="font-semibold text-gray-900 dark:text-white">
              {table}
            </p>
            <p
              className={`mt-1 text-xs ${
                ok ? "text-success-600" : "text-warning-600"
              }`}
            >
              {ok ? "พบตาราง" : "ไม่พบตาราง"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function HealthFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
        {value}
      </p>
    </div>
  );
}

function CompactFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="mt-0.5 truncate font-semibold text-gray-900 dark:text-white">
        {value}
      </dd>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 px-3 py-2.5 text-sm">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0 truncate font-semibold text-gray-900 dark:text-white">
        {value}
      </dd>
    </div>
  );
}

type ReadinessCheck = {
  ok: boolean;
  label: string;
  detail: string;
};

function ReadinessRow({ item }: { item: ReadinessCheck }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.02]">
      <div>
        <p className="text-sm font-semibold text-gray-900 dark:text-white">
          {item.label}
        </p>
        <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
          {item.detail}
        </p>
      </div>
      <Badge color={item.ok ? "success" : "warning"}>
        {item.ok ? "พร้อม" : "ต้องทำ"}
      </Badge>
    </div>
  );
}

function getTenantReadiness(
  item: TenantSummary,
  datasourceTest?: DatasourceTestResult,
) {
  const hasLineRoute =
    item.health.line_channels > 0 && item.health.line_targets_enabled > 0;
  const checks: ReadinessCheck[] = [
    {
      ok: item.access.enabled,
      label: "Subscription เปิดใช้งาน",
      detail: item.access.enabled
        ? "ลูกค้าเข้า dashboard และ scheduler ส่ง LINE ได้ตามสิทธิ์"
        : item.access.message,
    },
    {
      ok: datasourceTest ? datasourceTest.ok : item.health.datasource_configured,
      label: "SML datasource เชื่อมได้",
      detail: datasourceTest
        ? datasourceTest.ok
          ? `ทดสอบผ่าน ${datasourceTest.latency_ms} ms`
          : toDatasourceBusinessMessage(datasourceTest.safe_error_message)
        : item.health.datasource_configured
          ? "มี datasource config แล้ว ควรกดทดสอบก่อน rollout"
          : "ยังไม่ได้ตั้งค่า datasource สำหรับร้านนี้",
    },
    {
      ok: datasourceTest
        ? datasourceTest.required_tables.erp_branch_list
        : item.health.datasource_configured,
      label: "มี branch master",
      detail: datasourceTest
        ? datasourceTest.required_tables.erp_branch_list
          ? "พบ erp_branch_list สำหรับแปลงรหัสสาขาเป็นชื่อสาขา"
          : "ไม่พบ erp_branch_list ระบบจะ fallback เป็นรหัสสาขาจาก SML"
        : "กดทดสอบ SML เพื่อยืนยันตาราง erp_branch_list",
    },
    {
      ok: Boolean(item.health.latest_snapshot_at),
      label: "มีรายงานล่าสุด",
      detail: item.health.latest_snapshot_at
        ? `ล่าสุด ${formatDateTime(item.health.latest_snapshot_at)}`
        : "ยังไม่มี snapshot ให้ลูกค้าดู",
    },
    {
      ok: item.health.line_channels > 0,
      label: "LINE OA ลงทะเบียนแล้ว",
      detail: item.health.line_channels
        ? `${item.health.line_channels} LINE OA`
        : "ยังไม่มี LINE OA metadata สำหรับร้านนี้",
    },
    {
      ok: item.health.line_targets_enabled > 0,
      label: "มีกลุ่ม LINE ที่อนุมัติแล้ว",
      detail: `${item.health.line_targets_enabled}/${item.health.line_targets_total} target เปิดรับ Morning Brief`,
    },
    {
      ok: hasLineRoute && item.health.latest_line_delivery_status === "success",
      label: "ส่ง LINE ทดสอบสำเร็จ",
      detail: !hasLineRoute
        ? "ต้องตั้ง LINE OA และอนุมัติกลุ่มก่อน จึงค่อยนับผลส่งทดสอบ"
        : item.health.latest_line_delivery_at
        ? `${formatLineDeliveryStatus(item.health.latest_line_delivery_status)} · ${formatDateTime(item.health.latest_line_delivery_at)}`
        : "ยังไม่มี delivery log สำเร็จ",
    },
  ];
  const readyCount = checks.filter((check) => check.ok).length;
  const tone =
    readyCount === checks.length
      ? ("success" as const)
      : readyCount >= 4
        ? ("warning" as const)
        : ("error" as const);

  return {
    items: checks,
    readyCount,
    tone,
    label:
      readyCount === checks.length
        ? "พร้อม pilot"
        : `${readyCount}/${checks.length} พร้อม`,
  };
}

function getTenantNextStep(item: TenantSummary, checks: ReadinessCheck[]) {
  const firstMissing = checks.find((check) => !check.ok);
  if (!firstMissing) {
    return {
      actionLabel: "เปิด Dashboard",
      description: "ร้านนี้พร้อมสำหรับ pilot แล้ว ตรวจหน้าลูกค้าได้เลย",
      href: item.customer_dashboard_path ?? "/app",
    };
  }

  if (firstMissing.label.includes("Subscription")) {
    return {
      actionLabel: "เปิดร้าน",
      description: "ร้านถูกบล็อกหรือยังไม่เปิดใช้งาน ต้องแก้สถานะก่อน",
      href: "/owner/tenants",
    };
  }
  if (firstMissing.label.includes("SML")) {
    return {
      actionLabel: "ตรวจ SML",
      description: "ต้องทดสอบ datasource ก่อนรันรายงานหรือส่งให้ลูกค้า",
      href: "/owner/tenants",
    };
  }
  if (firstMissing.label.includes("รายงาน")) {
    return {
      actionLabel: "รันรายงาน",
      description: "ยังไม่มี snapshot ล่าสุดสำหรับ dashboard และ LINE",
      href: "/owner/reports",
    };
  }
  if (firstMissing.label.includes("LINE")) {
    return {
      actionLabel: "ตั้ง LINE",
      description: "ต้องเพิ่ม LINE OA หรืออนุมัติกลุ่มรับ Morning Brief",
      href: "/owner/line",
    };
  }

  return {
    actionLabel: "ดูรายละเอียด",
    description: firstMissing.detail,
    href: "/owner",
  };
}

function formatLineDeliveryStatus(status: string | null) {
  if (status === "success") {
    return "ส่งสำเร็จ";
  }
  if (status === "failed") {
    return "ส่งไม่สำเร็จ";
  }
  if (status === "skipped") {
    return "ข้ามการส่ง";
  }
  return "ยังไม่ทราบสถานะ";
}

function tenantStatusTone(status: Tenant["status"]) {
  if (status === "active" || status === "trial") {
    return "success" as const;
  }
  if (status === "past_due") {
    return "warning" as const;
  }
  if (status === "suspended" || status === "cancelled") {
    return "error" as const;
  }
  return "light" as const;
}

function formatTenantStatus(status: Tenant["status"]) {
  const labels: Record<Tenant["status"], string> = {
    trial: "ทดลองใช้",
    active: "ใช้งาน",
    past_due: "ค้างชำระ",
    suspended: "ระงับ",
    cancelled: "ยกเลิก",
  };
  return labels[status];
}

function formatCurrency(value: number) {
  return `${value.toLocaleString("th-TH", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} บาท`;
}

function formatReportPeriod(dateFrom: string, dateTo: string) {
  if (dateFrom === dateTo) {
    return dateFrom;
  }
  return `${dateFrom} ถึง ${dateTo}`;
}

function formatQualityStatus(status: SalesGoodsServicesSnapshot["quality_status"]) {
  if (status === "valid") {
    return "พร้อมใช้";
  }
  if (status === "reconciled_with_warning") {
    return "ควรตรวจยอด";
  }
  if (status === "failed") {
    return "ไม่สำเร็จ";
  }
  if (status === "stale") {
    return "ข้อมูลเก่า";
  }
  return "บางส่วน";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function slugifyTenantId(value: string) {
  const normalized = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized ? `tenant_${normalized}` : "";
}

function toDatasourceBusinessMessage(value: string | null) {
  if (!value) {
    return "เชื่อมต่อได้";
  }
  if (value.includes("not configured")) {
    return "ยังไม่ได้ตั้งค่าฐานข้อมูล SML สำหรับร้านนี้บน server";
  }
  if (value.includes("authentication")) {
    return "ชื่อผู้ใช้หรือรหัสผ่านฐานข้อมูลไม่ถูกต้อง";
  }
  if (value.includes("timed out")) {
    return "เชื่อมต่อฐานข้อมูลช้าเกินเวลาที่กำหนด";
  }
  if (value.includes("unreachable")) {
    return "ติดต่อฐานข้อมูลไม่ได้ กรุณาตรวจ host, port หรือ network/VPN";
  }
  if (value.includes("required SML tables")) {
    return "เชื่อมต่อได้ แต่ยังไม่พบตาราง SML ที่รายงานนี้ต้องใช้ครบ";
  }
  return "ทดสอบ datasource ไม่สำเร็จ กรุณาตรวจการตั้งค่าฐานข้อมูล";
}
