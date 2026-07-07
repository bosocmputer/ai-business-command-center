"use client";

import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  LineAccessProfileKey,
  LineChannelRecord,
  LineRecipientRecord,
  LineTargetRecord,
} from "@ai-bcc/shared";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { CheckCircleIcon, PlusIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import type { OwnerV2LineSetupPayload } from "./types";
import {
  Field,
  FormPanel,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  TechnicalDetails,
  formatDateTime,
} from "./ui";

type LineSetupState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2LineSetupPayload };

type ChannelFormState = {
  displayName: string;
  scope: LineChannelRecord["scope"];
  enabled: boolean;
};

type SecretFormState = {
  channelId: string;
  channelAccessToken: string;
  channelSecret: string;
};

type AssignmentFormState = {
  sourceTargetId: string;
  lineChannelId: string;
  profileKey: LineAccessProfileKey;
};

const profileOptions: Array<{
  value: LineAccessProfileKey;
  label: string;
  detail: string;
}> = [
  {
    value: "executive",
    label: "ผู้บริหาร",
    detail: "รับรายงานผู้บริหารและเปิด viewer ได้",
  },
  {
    value: "sales_manager",
    label: "ฝ่ายขาย",
    detail: "ใช้กับผู้จัดการฝ่ายขายหรือหัวหน้าหน้าร้าน",
  },
  {
    value: "operations",
    label: "ปฏิบัติการ",
    detail: "ใช้กับทีมดูแลระบบหรือทีมปฏิบัติการ",
  },
  {
    value: "staff",
    label: "พนักงาน",
    detail: "สิทธิ์จำกัดตาม role ของร้าน",
  },
];

const emptyChannels: LineChannelRecord[] = [];
const emptyTargets: LineTargetRecord[] = [];

export default function OwnerV2LineSetup({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<LineSetupState>({ status: "loading" });
  const [channelForm, setChannelForm] = useState<ChannelFormState>({
    displayName: "",
    scope: "tenant",
    enabled: true,
  });
  const [secretForm, setSecretForm] = useState<SecretFormState>({
    channelId: "",
    channelAccessToken: "",
    channelSecret: "",
  });
  const [assignmentForm, setAssignmentForm] = useState<AssignmentFormState>({
    sourceTargetId: "",
    lineChannelId: "",
    profileKey: "executive",
  });
  const [recipientsState, setRecipientsState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string; technicalMessage?: string }
    | { status: "success"; data: LineRecipientRecord[] }
  >({ status: "idle" });
  const [targetProfileDrafts, setTargetProfileDrafts] = useState<
    Record<string, LineAccessProfileKey>
  >({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    tone: "success" | "warning" | "error";
    text: string;
  } | null>(null);
  const [technicalMessage, setTechnicalMessage] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      setMessage(null);
      setTechnicalMessage(null);
      try {
        const data = await ownerV2Fetch<OwnerV2LineSetupPayload>(
          `/api/owner/tenants/${encodeURIComponent(tenantId)}/line-setup`,
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        setState({ status: "success", data });
        // The API can return explicit null for channels/targets on tenants
        // that have never been configured. Dereferencing null.channels /
        // null.targets below would crash the load callback (and leave the
        // page stuck on the skeleton). Guard both slices up front.
        const dataChannels = data.channels ?? [];
        const dataTargets = data.targets ?? [];
        setSecretForm((current) => ({
          ...current,
          channelId:
            current.channelId &&
            dataChannels.some((item) => item.id === current.channelId)
              ? current.channelId
              : (dataChannels[0]?.id ?? ""),
          channelAccessToken: "",
          channelSecret: "",
        }));
        setAssignmentForm((current) => ({
          ...current,
          lineChannelId:
            current.lineChannelId &&
            dataChannels.some((item) => item.id === current.lineChannelId)
              ? current.lineChannelId
              : (dataChannels[0]?.id ?? ""),
        }));
        setTargetProfileDrafts((current) => {
          const next = { ...current };
          for (const target of dataTargets) {
            next[target.id] = next[target.id] ?? target.access_profile_key;
          }
          return next;
        });
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดการตั้งค่า LINE ไม่สำเร็จ",
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

  // Auto-load the recipient library when the tenant has no targets yet, so the
  // admin can immediately pick a recipient instead of hunting for the button.
  // Keeps the manual lazy path for tenants that already have targets.
  useEffect(() => {
    if (
      state.status === "success" &&
      (state.data.targets ?? []).length === 0 &&
      recipientsState.status === "idle"
    ) {
      void loadRecipients();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.status,
    state.status === "success" ? (state.data.targets ?? []).length : 0,
  ]);

  const setup = state.status === "success" ? state.data : null;
  const channels = setup?.channels ?? emptyChannels;
  const targets = setup?.targets ?? emptyTargets;
  const readyTargets = useMemo(
    () => targets.filter((target) => isLineTargetReady(target, channels)),
    [channels, targets],
  );
  const approvedTargets = useMemo(
    () => targets.filter((target) => target.approved),
    [targets],
  );
  const quotaSummary = useMemo(
    () => calculateQuotaSummary(readyTargets),
    [readyTargets],
  );
  const personalTargets = useMemo(
    () =>
      targets.filter(
        (target) => target.target_type === "user" && target.approved,
      ),
    [targets],
  );
  const teamTargets = useMemo(
    () =>
      targets.filter(
        (target) => target.target_type !== "user" && target.approved,
      ),
    [targets],
  );
  const pendingTargets = useMemo(
    () => targets.filter((target) => !target.approved),
    [targets],
  );
  const secretReadyChannels = useMemo(
    () =>
      channels.filter(
        (channel) =>
          channel.enabled &&
          channel.channel_access_token_configured &&
          channel.channel_secret_configured,
      ),
    [channels],
  );
  const selectableRecipients =
    recipientsState.status === "success"
      ? recipientsState.data.filter(
          (recipient) => !recipient.assigned_tenant_ids.includes(tenantId),
        )
      : [];

  const createDisabled =
    busy !== null ||
    state.status !== "success" ||
    channelForm.displayName.trim().length < 2;
  const saveSecretDisabled =
    busy !== null ||
    state.status !== "success" ||
    !secretForm.channelId ||
    (!secretForm.channelAccessToken.trim() && !secretForm.channelSecret.trim());
  const assignDisabled =
    busy !== null ||
    state.status !== "success" ||
    !assignmentForm.sourceTargetId ||
    !assignmentForm.lineChannelId;

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createDisabled) {
      setMessage({
        tone: "warning",
        text: "ตั้งชื่อ LINE OA อย่างน้อย 2 ตัวอักษรก่อนสร้างช่องทาง",
      });
      setTechnicalMessage(null);
      return;
    }
    setBusy("create-channel");
    setMessage(null);
    setTechnicalMessage(null);
    try {
      await ownerV2Fetch<LineChannelRecord>("/api/owner/line-channels", {
        method: "POST",
        body: {
          tenant_id: tenantId,
          display_name: channelForm.displayName.trim(),
          scope: channelForm.scope ?? "tenant",
          enabled: channelForm.enabled,
        },
      });
      setChannelForm({ displayName: "", scope: "tenant", enabled: true });
      setMessage({
        tone: "success",
        text: "เพิ่ม LINE OA แล้ว ขั้นต่อไปบันทึกรหัสส่งข้อความและรหัสรับ Webhook",
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text: "สร้าง LINE OA ไม่สำเร็จ ลองตรวจชื่อช่องทางและสิทธิ์ผู้ดูแล แล้วสร้างใหม่",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveChannelSecrets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saveSecretDisabled) {
      setMessage({
        tone: "warning",
        text: secretForm.channelId
          ? "กรอกรหัสส่งข้อความหรือรหัสรับ Webhook อย่างน้อย 1 ค่า"
          : "เลือก LINE OA ก่อนบันทึกรหัส",
      });
      setTechnicalMessage(null);
      return;
    }

    const body: {
      channel_access_token?: string;
      channel_secret?: string;
    } = {};
    if (secretForm.channelAccessToken.trim()) {
      body.channel_access_token = secretForm.channelAccessToken.trim();
    }
    if (secretForm.channelSecret.trim()) {
      body.channel_secret = secretForm.channelSecret.trim();
    }

    setBusy("save-secrets");
    setMessage(null);
    setTechnicalMessage(null);
    try {
      await ownerV2Fetch<LineChannelRecord>(
        `/api/owner/line-channels/${encodeURIComponent(secretForm.channelId)}/secrets`,
        {
          method: "PUT",
          body,
        },
      );
      setSecretForm((current) => ({
        ...current,
        channelAccessToken: "",
        channelSecret: "",
      }));
      setMessage({
        tone: "success",
        text: "บันทึกรหัส LINE OA แล้ว ระบบจะไม่แสดงค่าลับกลับบนหน้าจอ",
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text: "บันทึกรหัส LINE OA ไม่สำเร็จ ลองตรวจค่าที่กรอกและกุญแจเข้ารหัสบนเครื่องแม่ข่าย",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function toggleChannel(channel: LineChannelRecord) {
    setBusy(`channel-${channel.id}`);
    setMessage(null);
    setTechnicalMessage(null);
    try {
      await ownerV2Fetch<LineChannelRecord>(
        `/api/owner/line-channels/${encodeURIComponent(channel.id)}`,
        {
          method: "PATCH",
          body: { enabled: !channel.enabled },
        },
      );
      setMessage({
        tone: "success",
        text: `${channel.display_name}: ${channel.enabled ? "ปิดใช้งาน" : "เปิดใช้งาน"}แล้ว`,
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text: "อัปเดตสถานะ LINE OA ไม่สำเร็จ ลองรีเฟรชแล้วทำรายการใหม่",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function loadRecipients() {
    setRecipientsState({ status: "loading" });
    try {
      const data = await ownerV2Fetch<LineRecipientRecord[]>(
        "/api/owner/line-recipients",
      );
      setRecipientsState({ status: "success", data });
      setAssignmentForm((current) => ({
        ...current,
        sourceTargetId:
          current.sourceTargetId &&
          data.some((item) => item.source_target_id === current.sourceTargetId)
            ? current.sourceTargetId
            : (data.find((item) => !item.assigned_tenant_ids.includes(tenantId))
                ?.source_target_id ?? ""),
      }));
    } catch (error) {
      setRecipientsState({
        status: "error",
        message: "โหลดคลังผู้รับ LINE ไม่สำเร็จ",
        technicalMessage: toLineTechnicalMessage(error),
      });
    }
  }

  async function assignRecipient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (assignDisabled) {
      setMessage({
        tone: "warning",
        text: assignmentForm.sourceTargetId
          ? "เลือก LINE OA ที่จะใช้ส่งให้ผู้รับนี้ก่อน"
          : "เลือกผู้รับจากคลัง LINE ก่อนเพิ่มเข้าร้าน",
      });
      setTechnicalMessage(null);
      return;
    }
    setBusy("assign-recipient");
    setMessage(null);
    setTechnicalMessage(null);
    try {
      const assigned = await ownerV2Fetch<LineTargetRecord>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/line-target-assignments`,
        {
          method: "POST",
          body: {
            source_target_id: assignmentForm.sourceTargetId,
            line_channel_id: assignmentForm.lineChannelId,
            access_profile_key: assignmentForm.profileKey,
          },
        },
      );
      setMessage({
        tone: "success",
        text: `${assigned.display_name}: เพิ่มเป็นผู้รับของร้านนี้แล้ว`,
      });
      await Promise.all([load(), loadRecipients()]);
    } catch (error) {
      setMessage({
        tone: "error",
        text: "เพิ่มผู้รับ LINE เข้าร้านไม่สำเร็จ ลองเลือกผู้รับและ LINE OA ใหม่อีกครั้ง",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function approveTarget(target: LineTargetRecord) {
    const profileKey =
      targetProfileDrafts[target.id] ?? target.access_profile_key;
    setBusy(`approve-${target.id}`);
    setMessage(null);
    setTechnicalMessage(null);
    try {
      const updated = await ownerV2Fetch<LineTargetRecord>(
        `/api/line-targets/${encodeURIComponent(target.id)}/approve`,
        {
          method: "POST",
          body: {
            access_profile_key: profileKey,
            enabled: true,
          },
        },
      );
      setMessage({
        tone: "success",
        text: `${updated.display_name}: อนุมัติและเปิดรับแจ้งเตือนแล้ว`,
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text: "อนุมัติผู้รับ LINE ไม่สำเร็จ ลองรีเฟรชแล้วอนุมัติใหม่",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function testSendTarget(target: LineTargetRecord) {
    if (busy !== null) {
      return;
    }
    if (
      !window.confirm(
        `ส่งข้อความทดสอบจริงไปยัง ${target.display_name}? การส่งนี้ใช้โควต้า LINE OA จริง`,
      )
    ) {
      return;
    }
    setBusy(`test-send-${target.id}`);
    setMessage(null);
    setTechnicalMessage(null);
    try {
      await ownerV2Fetch(
        `/api/line-targets/${encodeURIComponent(target.id)}/test-send`,
        {
          method: "POST",
          body: { mode: "send" },
        },
      );
      setMessage({
        tone: "success",
        text: `ส่งข้อความทดสอบจริงไปยัง ${target.display_name} แล้ว ตรวจ LINE ของผู้รับ`,
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: "ส่งข้อความทดสอบไม่สำเร็จ ตรวจโควต้า LINE OA และสถานะผู้รับก่อนลองใหม่",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function updateTargetProfile(target: LineTargetRecord) {
    const profileKey =
      targetProfileDrafts[target.id] ?? target.access_profile_key;
    if (profileKey === target.access_profile_key) {
      setMessage({
        tone: "warning",
        text: "สิทธิ์ผู้รับยังไม่เปลี่ยน ไม่ต้องบันทึกซ้ำ",
      });
      setTechnicalMessage(null);
      return;
    }
    setBusy(`profile-${target.id}`);
    setMessage(null);
    setTechnicalMessage(null);
    try {
      const updated = await ownerV2Fetch<LineTargetRecord>(
        `/api/line-targets/${encodeURIComponent(target.id)}`,
        {
          method: "PATCH",
          body: { access_profile_key: profileKey },
        },
      );
      setMessage({
        tone: "success",
        text: `${updated.display_name}: อัปเดตสิทธิ์เป็น ${formatProfileKey(
          updated.access_profile_key,
        )} แล้ว`,
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text: "อัปเดตสิทธิ์ผู้รับไม่สำเร็จ ลองรีเฟรชแล้วบันทึกใหม่",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function toggleTarget(target: LineTargetRecord) {
    setBusy(`target-${target.id}`);
    setMessage(null);
    setTechnicalMessage(null);
    try {
      const updated = await ownerV2Fetch<LineTargetRecord>(
        `/api/line-targets/${encodeURIComponent(target.id)}`,
        {
          method: "PATCH",
          body: { enabled: !target.enabled },
        },
      );
      setMessage({
        tone: "success",
        text: `${updated.display_name}: ${
          updated.enabled ? "เปิดรับแจ้งเตือน" : "ปิดรับแจ้งเตือน"
        }แล้ว`,
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text: "อัปเดตสถานะผู้รับ LINE ไม่สำเร็จ ลองรีเฟรชแล้วทำรายการใหม่",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function updateRecipientEstimate(
    target: LineTargetRecord,
    estimate: number | null,
  ) {
    if (busy !== null) {
      return;
    }
    setBusy(`estimate-${target.id}`);
    setMessage(null);
    setTechnicalMessage(null);
    try {
      await ownerV2Fetch(`/api/line-targets/${encodeURIComponent(target.id)}`, {
        method: "PATCH",
        body: { recipient_count_estimate: estimate },
      });
      setMessage({
        tone: "success",
        text: `บันทึกจำนวนผู้รับโดยประมาณของ ${target.display_name} แล้ว`,
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text: "บันทึกจำนวนผู้รับโดยประมาณไม่สำเร็จ ลองตรวจตัวเลขแล้วบันทึกใหม่",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function enableMorningBriefAction(target: LineTargetRecord) {
    const allowedActions = Array.from(
      new Set([...target.allowed_actions, "receive_morning_brief"]),
    );
    setBusy(`actions-${target.id}`);
    setMessage(null);
    setTechnicalMessage(null);
    try {
      await ownerV2Fetch<LineTargetRecord>(
        `/api/line-targets/${encodeURIComponent(target.id)}`,
        {
          method: "PATCH",
          body: { allowed_actions: allowedActions },
        },
      );
      setMessage({
        tone: "success",
        text: `${target.display_name}: เปิดสิทธิ์รับแผนแจ้งเตือนแล้ว`,
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text: "เปิดสิทธิ์รับแผนแจ้งเตือนไม่สำเร็จ ลองรีเฟรชแล้วเปิดสิทธิ์ใหม่",
      });
      setTechnicalMessage(toLineTechnicalMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return (
      <div className="space-y-5 sm:space-y-6">
        <LineSetupSkeleton />
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="space-y-5 sm:space-y-6">
        <Panel>
          <PanelBody spaced>
            <Notice
              text="ลองโหลดใหม่อีกครั้ง ถ้ายังไม่สำเร็จ ให้เปิดศูนย์ตรวจระบบหรือเข้าสู่ระบบผู้ดูแลใหม่"
              title="โหลด LINE OA ไม่สำเร็จ"
              tone="error"
            />
            <TechnicalDetails embedded title="รายละเอียดข้อผิดพลาด">
              <p className="break-words text-sm leading-6 text-gray-500 dark:text-gray-400">
                {state.message}
              </p>
            </TechnicalDetails>
            <Button
              className="mt-4"
              onClick={() => void load()}
              size="sm"
              type="button"
            >
              รีเฟรช LINE
            </Button>
          </PanelBody>
        </Panel>
      </div>
    );
  }

  const readinessChecks = buildReadinessChecks({
    channels,
    approvedTargets,
    readyTargets,
    secretReadyChannels,
    totalTargets: targets.length,
  });
  const readyCheckCount = readinessChecks.filter((item) => item.ok).length;
  const readinessTone =
    readyCheckCount === readinessChecks.length
      ? "success"
      : readyCheckCount >= 2
        ? "warning"
        : "error";

  return (
    <div className="space-y-5 sm:space-y-6">
      {message ? (
        <Notice title="สถานะ LINE OA" tone={message.tone} text={message.text} />
      ) : null}
      {technicalMessage ? (
        <TechnicalDetails embedded title="รายละเอียดการทำรายการ">
          <p className="break-words text-sm leading-6 text-gray-500 dark:text-gray-400">
            {technicalMessage}
          </p>
        </TechnicalDetails>
      ) : null}

      <Panel>
        <PanelBody spaced>
          <Notice
            tone="warning"
            title="ตั้งค่า Webhook ใน LINE Developers"
            text={
              <>
                ตั้ง Webhook URL เป็น{" "}
                <span className="break-all font-mono">
                  {typeof window !== "undefined"
                    ? window.location.origin
                    : "{public-origin}"}
                  /api/line/webhook
                </span>{" "}
                แล้วเปิด "Use webhook" ใน LINE OA ของร้าน เพื่อให้ระบบรับ
                ข้อมูลผู้รับได้
              </>
            }
          />
          <Notice
            tone="info"
            title="ทดสอบ LINE อย่างปลอดภัย"
            text="ปุ่มส่งทดสอบเป็นการส่งข้อความจริงและใช้โควต้า LINE OA จริง ควรทดสอบกับผู้รับของทีมก่อนเพิ่มกลุ่มลูกค้าหรือผู้บริหารของร้าน"
          />
        </PanelBody>
      </Panel>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5 sm:space-y-6">
          <Panel>
            <PanelHeader
              action={
                <Badge color={readinessTone}>
                  {readyCheckCount}/{readinessChecks.length} พร้อม
                </Badge>
              }
              description="ตั้งค่า LINE OA, บันทึกรหัสส่งข้อความ/รับ Webhook, แล้วเพิ่มผู้รับเข้าร้านก่อนเปิดแผนแจ้งเตือน"
              title={`LINE OA ของ ${state.data.tenant.name}`}
            />
            <PanelBody spaced>
              <div className="grid gap-3 lg:grid-cols-2">
                {readinessChecks.map((check) => (
                  <ReadinessItem check={check} key={check.label} />
                ))}
              </div>
              <LineSetupGuide
                checks={readinessChecks}
                quotaSummary={quotaSummary}
              />
            </PanelBody>
          </Panel>

          <FormPanel
            as="form"
            description="เพิ่ม OA ของร้านหรือ OA กลาง แล้วเปิดใช้งานเฉพาะช่องทางที่พร้อมส่ง"
            onSubmit={createChannel}
            title="เพิ่ม LINE OA"
          >
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_180px_120px_auto]">
              <Field
                label="ชื่อ LINE OA"
                help="ตั้งชื่อให้อ่านรู้ทันทีว่าเป็น OA ของร้านไหน หรือเป็น OA กลางของระบบ"
              >
                <input
                  className="owner-v2-input"
                  onChange={(event) =>
                    setChannelForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  placeholder="เช่น กระบี่ LINE OA"
                  value={channelForm.displayName}
                />
              </Field>
              <Field
                label="ขอบเขต"
                help="เลือก OA กลางเฉพาะกรณีตั้งใจใช้ช่องทางเดียวร่วมหลายร้าน เพราะโควต้าจะถูกใช้ร่วมกัน"
              >
                <select
                  className="owner-v2-input"
                  onChange={(event) =>
                    setChannelForm((current) => ({
                      ...current,
                      scope: event.target.value as LineChannelRecord["scope"],
                    }))
                  }
                  value={channelForm.scope ?? "tenant"}
                >
                  <option value="tenant">ของร้านนี้</option>
                  <option value="owner_shared">OA กลาง</option>
                </select>
              </Field>
              <Field
                label="สถานะ"
                help="ปิดไว้ก่อนได้ระหว่างยังไม่ได้บันทึกรหัสหรือยังไม่ต้องการให้ส่งจริง"
              >
                <select
                  className="owner-v2-input"
                  onChange={(event) =>
                    setChannelForm((current) => ({
                      ...current,
                      enabled: event.target.value === "true",
                    }))
                  }
                  value={channelForm.enabled ? "true" : "false"}
                >
                  <option value="true">เปิด</option>
                  <option value="false">ปิด</option>
                </select>
              </Field>
              <div className="flex items-end">
                <Button
                  className="w-full"
                  disabled={createDisabled}
                  size="sm"
                  startIcon={<PlusIcon className="size-4" />}
                  type="submit"
                >
                  เพิ่ม OA
                </Button>
              </div>
            </div>
          </FormPanel>

          <Panel>
            <PanelHeader
              description="ตรวจช่องทางที่บันทึกแล้วและเปิด/ปิดการใช้งานได้จากตรงนี้"
              title="ช่องทาง LINE OA"
            />
            <PanelBody>
              <ChannelTable
                busy={busy}
                channels={channels}
                onToggleChannel={toggleChannel}
              />
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              description="อนุมัติผู้รับ, เลือกสิทธิ์เริ่มต้น และตรวจว่าผู้รับพร้อมรับรายงาน"
              title="ผู้รับ LINE ของร้าน"
            />
            <PanelBody spaced>
              {targets.length ? (
                <>
                  <div className="mb-4 flex items-center gap-2">
                    <Badge color="light" size="sm">
                      โควต้า LINE:{" "}
                      {formatEstimatedMonthlyMessages(quotaSummary)}
                    </Badge>
                  </div>
                  <TargetGroup targets={personalTargets} title="ผู้บริหารรายคน">
                    <TargetTable
                      busy={busy}
                      channels={channels}
                      onApproveTarget={approveTarget}
                      onEnableMorningBriefAction={enableMorningBriefAction}
                      onTestSendTarget={testSendTarget}
                      onTargetProfileChange={(targetId, profileKey) =>
                        setTargetProfileDrafts((current) => ({
                          ...current,
                          [targetId]: profileKey,
                        }))
                      }
                      onToggleTarget={toggleTarget}
                      onUpdateRecipientEstimate={updateRecipientEstimate}
                      onUpdateTargetProfile={updateTargetProfile}
                      targetProfileDrafts={targetProfileDrafts}
                      targets={personalTargets}
                    />
                  </TargetGroup>
                  <TargetGroup targets={teamTargets} title="กลุ่มทีมงาน">
                    <TargetTable
                      busy={busy}
                      channels={channels}
                      onApproveTarget={approveTarget}
                      onEnableMorningBriefAction={enableMorningBriefAction}
                      onTestSendTarget={testSendTarget}
                      onTargetProfileChange={(targetId, profileKey) =>
                        setTargetProfileDrafts((current) => ({
                          ...current,
                          [targetId]: profileKey,
                        }))
                      }
                      onToggleTarget={toggleTarget}
                      onUpdateRecipientEstimate={updateRecipientEstimate}
                      onUpdateTargetProfile={updateTargetProfile}
                      targetProfileDrafts={targetProfileDrafts}
                      targets={teamTargets}
                    />
                  </TargetGroup>
                  <TargetGroup targets={pendingTargets} title="รออนุมัติ">
                    <TargetTable
                      busy={busy}
                      channels={channels}
                      onApproveTarget={approveTarget}
                      onEnableMorningBriefAction={enableMorningBriefAction}
                      onTestSendTarget={testSendTarget}
                      onTargetProfileChange={(targetId, profileKey) =>
                        setTargetProfileDrafts((current) => ({
                          ...current,
                          [targetId]: profileKey,
                        }))
                      }
                      onToggleTarget={toggleTarget}
                      onUpdateRecipientEstimate={updateRecipientEstimate}
                      onUpdateTargetProfile={updateTargetProfile}
                      targetProfileDrafts={targetProfileDrafts}
                      targets={pendingTargets}
                    />
                  </TargetGroup>
                </>
              ) : (
                <EmptyState
                  action={
                    <Button
                      onClick={() => void loadRecipients()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      โหลดคลังผู้รับ
                    </Button>
                  }
                  detail="ให้ผู้รับเพิ่ม LINE OA เป็นเพื่อน ระบบรับข้อมูลอัตโนมัติ หรือเลือกผู้รับจากคลังที่มีอยู่"
                  title="ยังไม่มีผู้รับ LINE ในร้านนี้"
                />
              )}
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-5 sm:space-y-6">
          <FormPanel
            as="form"
            description="ระบบไม่แสดงรหัสลับที่บันทึกไว้กลับมาบนหน้าจอ"
            onSubmit={saveChannelSecrets}
            title="บันทึกรหัส LINE OA"
          >
            <Field
              label="เลือก LINE OA"
              help="เลือกรายการที่ต้องการเพิ่มหรือเปลี่ยนรหัสลับ"
            >
              <select
                className="owner-v2-input"
                disabled={!channels.length}
                onChange={(event) =>
                  setSecretForm((current) => ({
                    ...current,
                    channelId: event.target.value,
                  }))
                }
                value={secretForm.channelId}
              >
                {channels.length ? null : (
                  <option value="">ยังไม่มี LINE OA</option>
                )}
                {channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.display_name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="รหัสส่งข้อความ"
              help="ใช้สำหรับส่ง LINE จริง ถ้าเปลี่ยนรหัสต้องทดสอบส่งอีกครั้ง"
            >
              <input
                autoComplete="off"
                className="owner-v2-input"
                onChange={(event) =>
                  setSecretForm((current) => ({
                    ...current,
                    channelAccessToken: event.target.value,
                  }))
                }
                placeholder="ไม่แสดงค่าที่บันทึกไว้"
                type="password"
                value={secretForm.channelAccessToken}
              />
            </Field>
            <Field
              label="รหัสรับ Webhook"
              help="ใช้ตรวจว่าข้อความ/การเพิ่มเพื่อนมาจาก LINE OA นี้จริง"
            >
              <input
                autoComplete="off"
                className="owner-v2-input"
                onChange={(event) =>
                  setSecretForm((current) => ({
                    ...current,
                    channelSecret: event.target.value,
                  }))
                }
                placeholder="ไม่แสดงค่าที่บันทึกไว้"
                type="password"
                value={secretForm.channelSecret}
              />
            </Field>
            <Button
              className="w-full"
              disabled={saveSecretDisabled}
              size="sm"
              type="submit"
            >
              บันทึกรหัส LINE OA
            </Button>
            <p className="text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
              ถ้าเปลี่ยนค่า ให้กรอกเฉพาะช่องที่ต้องการอัปเดตแล้วกดบันทึก
            </p>
          </FormPanel>

          <Panel>
            <PanelHeader
              action={
                recipientsState.status === "success" ? (
                  <Badge color="info">
                    {selectableRecipients.length} เลือกได้
                  </Badge>
                ) : null
              }
              description="โหลดเฉพาะตอนต้องเพิ่มผู้รับ เพื่อลดเวลาเปิดหน้า LINE"
              title="เพิ่มผู้รับจากคลัง"
            />
            <PanelBody spaced>
              {recipientsState.status === "idle" ? (
                <EmptyState
                  action={
                    <Button
                      disabled={busy !== null}
                      onClick={() => void loadRecipients()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      โหลดคลังผู้รับ
                    </Button>
                  }
                  detail="โหลดเมื่อต้องใช้เท่านั้น เพื่อลดเวลาหน้าแรกและไม่ดึงรายการกว้างโดยไม่จำเป็น"
                  title="ยังไม่ได้โหลดคลังผู้รับ"
                />
              ) : null}
              {recipientsState.status === "loading" ? <MiniSkeleton /> : null}
              {recipientsState.status === "error" ? (
                <div className="space-y-3">
                  <Notice
                    text={`${recipientsState.message} ลองโหลดใหม่ หรือให้ผู้รับเพิ่ม LINE OA เป็นเพื่อนอีกครั้ง`}
                    title="โหลดคลังผู้รับไม่สำเร็จ"
                    tone="error"
                  />
                  {recipientsState.technicalMessage ? (
                    <TechnicalDetails embedded title="รายละเอียดคลังผู้รับ">
                      <p className="break-words text-sm leading-6 text-gray-500 dark:text-gray-400">
                        {recipientsState.technicalMessage}
                      </p>
                    </TechnicalDetails>
                  ) : null}
                </div>
              ) : null}
              {recipientsState.status === "success" ? (
                <form className="space-y-4" onSubmit={assignRecipient}>
                  <Field
                    label="ผู้รับ"
                    help="ถ้าไม่พบชื่อ ให้ผู้รับเพิ่ม LINE OA เป็นเพื่อนหรือส่งข้อความหา OA ก่อน"
                  >
                    <select
                      className="owner-v2-input"
                      disabled={!selectableRecipients.length}
                      onChange={(event) =>
                        setAssignmentForm((current) => ({
                          ...current,
                          sourceTargetId: event.target.value,
                        }))
                      }
                      value={assignmentForm.sourceTargetId}
                    >
                      {selectableRecipients.length ? null : (
                        <option value="">ไม่มีผู้รับที่เลือกเพิ่มได้</option>
                      )}
                      {selectableRecipients.map((recipient) => (
                        <option
                          key={recipient.source_target_id}
                          value={recipient.source_target_id}
                        >
                          {recipient.display_name} ·{" "}
                          {recipient.target_id_masked}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="ส่งผ่าน LINE OA"
                    help="ผู้รับนี้จะใช้ OA ที่เลือกในการรับรายงานและข้อความทดสอบ"
                  >
                    <select
                      className="owner-v2-input"
                      disabled={!channels.length}
                      onChange={(event) =>
                        setAssignmentForm((current) => ({
                          ...current,
                          lineChannelId: event.target.value,
                        }))
                      }
                      value={assignmentForm.lineChannelId}
                    >
                      {channels.length ? null : (
                        <option value="">เพิ่ม LINE OA ก่อน</option>
                      )}
                      {channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.display_name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="สิทธิ์เริ่มต้น"
                    help="สิทธิ์นี้กำหนดชุดรายงานที่ผู้รับควรเห็นใน LINE และ signed viewer"
                  >
                    <select
                      className="owner-v2-input"
                      onChange={(event) =>
                        setAssignmentForm((current) => ({
                          ...current,
                          profileKey: event.target
                            .value as LineAccessProfileKey,
                        }))
                      }
                      value={assignmentForm.profileKey}
                    >
                      {profileOptions.map((profile) => (
                        <option key={profile.value} value={profile.value}>
                          {profile.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button
                    className="w-full"
                    disabled={assignDisabled}
                    size="sm"
                    type="submit"
                  >
                    เพิ่มผู้รับเข้าร้าน
                  </Button>
                </form>
              ) : null}
            </PanelBody>
          </Panel>

          {readyTargets.length > 0 ? (
            <Panel>
              <PanelHeader
                description="ผู้รับพร้อมส่งแล้ว ไปตั้งค่าขั้นถัดไปได้"
                title="พร้อมไปต่อ"
              />
              <PanelBody spaced>
                <NextAction
                  href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/permissions`}
                  ok
                  text="ตรวจสิทธิ์รายงานตาม role ของผู้รับ"
                  title="สิทธิ์รายงาน"
                />
                <NextAction
                  href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/notifications`}
                  ok
                  text="ผูกผู้รับเข้ากับแผนแจ้งเตือนของร้าน"
                  title="แผนแจ้งเตือน"
                />
              </PanelBody>
            </Panel>
          ) : (
            <Panel>
              <PanelHeader title="ยังไปต่อไม่ได้" />
              <PanelBody spaced>
                <Notice
                  tone="warning"
                  title="ยังไม่มีผู้รับพร้อมส่ง"
                  text="อนุมัติผู้รับและเปิดรับสรุปประจำวันก่อน จึงจะตั้งสิทธิ์รายงานหรือแผนแจ้งเตือนได้"
                />
              </PanelBody>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

function ChannelTable({
  busy,
  channels,
  onToggleChannel,
}: {
  busy: string | null;
  channels: LineChannelRecord[];
  onToggleChannel: (channel: LineChannelRecord) => void;
}) {
  if (!channels.length) {
    return (
      <EmptyState
        detail="เริ่มจากเพิ่ม LINE OA ของร้าน แล้วบันทึกรหัสส่งข้อความและรหัสรับ Webhook"
        title="ยังไม่มี LINE OA"
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="space-y-3 md:hidden">
        {channels.map((channel) => (
          <div
            className="rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]"
            key={channel.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-theme-sm font-medium text-gray-800 dark:text-white/90">
                  {channel.display_name}
                </p>
                <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                  {formatLineChannelSource(channel)}
                </p>
              </div>
              <Badge color={channel.enabled ? "success" : "warning"}>
                {channel.enabled ? "เปิดใช้งาน" : "ปิดอยู่"}
              </Badge>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  ขอบเขต
                </p>
                <div className="mt-1">
                  <Badge
                    color={channel.scope === "owner_shared" ? "info" : "light"}
                  >
                    {channel.scope === "owner_shared"
                      ? "OA กลาง"
                      : "ของร้านนี้"}
                  </Badge>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                  ค่าลับ
                </p>
                <StatusText
                  ok={channel.channel_access_token_configured}
                  text="รหัสส่งข้อความ"
                />
                <StatusText
                  ok={channel.channel_secret_configured}
                  text="รหัสรับ Webhook"
                />
              </div>
            </div>
            <Button
              className="mt-4 w-full"
              disabled={busy !== null || channel.source === "env"}
              onClick={() => onToggleChannel(channel)}
              size="sm"
              type="button"
              variant="outline"
            >
              {channel.enabled ? "ปิด" : "เปิด"}
            </Button>
          </div>
        ))}
      </div>

      <div className="hidden w-full overflow-x-auto md:block">
        <table className="min-w-full">
          <thead>
            <tr className="border-y border-gray-100 dark:border-gray-800">
              {["LINE OA", "ขอบเขต", "ค่าลับ", "สถานะ", "จัดการ"].map(
                (label) => (
                  <th className="py-3 pr-5 text-left sm:pr-6" key={label}>
                    <p className="font-medium text-gray-500 text-theme-xs dark:text-gray-400">
                      {label}
                    </p>
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {channels.map((channel) => (
              <tr key={channel.id}>
                <td className="py-4 pr-5 sm:pr-6">
                  <div>
                    <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                      {channel.display_name}
                    </p>
                    <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                      {formatLineChannelSource(channel)}
                    </p>
                  </div>
                </td>
                <td className="py-4 pr-5 sm:pr-6">
                  <Badge
                    color={channel.scope === "owner_shared" ? "info" : "light"}
                  >
                    {channel.scope === "owner_shared"
                      ? "OA กลาง"
                      : "ของร้านนี้"}
                  </Badge>
                </td>
                <td className="py-4 pr-5 sm:pr-6">
                  <div className="space-y-1">
                    <StatusText
                      ok={channel.channel_access_token_configured}
                      text="รหัสส่งข้อความ"
                    />
                    <StatusText
                      ok={channel.channel_secret_configured}
                      text="รหัสรับ Webhook"
                    />
                  </div>
                </td>
                <td className="py-4 pr-5 sm:pr-6">
                  <Badge color={channel.enabled ? "success" : "warning"}>
                    {channel.enabled ? "เปิดใช้งาน" : "ปิดอยู่"}
                  </Badge>
                </td>
                <td className="py-4 pr-5 sm:pr-6">
                  <Button
                    disabled={busy !== null || channel.source === "env"}
                    onClick={() => onToggleChannel(channel)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {channel.enabled ? "ปิด" : "เปิด"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <TechnicalDetails
          embedded
          title="รายละเอียดเทคนิคของ LINE OA"
          description="ใช้เฉพาะตอนทีมดูแลระบบต้องเทียบรหัสภายในกับฐานข้อมูลหรือบันทึกระบบ"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {channels.map((channel) => (
              <div
                className="rounded-lg bg-white p-3 dark:bg-gray-900"
                key={channel.id}
              >
                <p className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
                  {channel.display_name}
                </p>
                <p className="mt-1 break-all font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                  {channel.id}
                </p>
              </div>
            ))}
          </div>
        </TechnicalDetails>
      </div>
    </div>
  );
}

function TargetTable({
  busy,
  channels,
  onApproveTarget,
  onEnableMorningBriefAction,
  onTargetProfileChange,
  onTestSendTarget,
  onToggleTarget,
  onUpdateRecipientEstimate,
  onUpdateTargetProfile,
  targetProfileDrafts,
  targets,
}: {
  busy: string | null;
  channels: LineChannelRecord[];
  onApproveTarget: (target: LineTargetRecord) => void;
  onEnableMorningBriefAction: (target: LineTargetRecord) => void;
  onTargetProfileChange: (
    targetId: string,
    profileKey: LineAccessProfileKey,
  ) => void;
  onTestSendTarget: (target: LineTargetRecord) => void;
  onToggleTarget: (target: LineTargetRecord) => void;
  onUpdateRecipientEstimate: (
    target: LineTargetRecord,
    estimate: number | null,
  ) => void;
  onUpdateTargetProfile: (target: LineTargetRecord) => void;
  targetProfileDrafts: Record<string, LineAccessProfileKey>;
  targets: LineTargetRecord[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="space-y-3 lg:hidden">
        {targets.map((target) => {
          const channel = target.line_channel_id
            ? channels.find((item) => item.id === target.line_channel_id)
            : null;
          const ready = isLineTargetReady(target, channels);
          const missingBriefAction = !target.allowed_actions.includes(
            "receive_morning_brief",
          );
          const profileDraft =
            targetProfileDrafts[target.id] ?? target.access_profile_key;
          return (
            <div
              className="rounded-lg bg-gray-50 p-4 dark:bg-white/[0.02]"
              key={target.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-theme-sm font-medium text-gray-800 dark:text-white/90">
                    {target.display_name}
                  </p>
                  <p className="mt-1 break-all text-theme-xs text-gray-500 dark:text-gray-400">
                    {formatTargetType(target.target_type)} ·{" "}
                    <span className="font-mono">{target.target_id_masked}</span>
                  </p>
                </div>
                <Badge
                  color={
                    ready ? "success" : target.approved ? "warning" : "error"
                  }
                >
                  {ready
                    ? "พร้อมส่ง"
                    : target.approved
                      ? "ยังไม่ครบ"
                      : "รออนุมัติ"}
                </Badge>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                    สิทธิ์
                  </p>
                  <select
                    className="owner-v2-input"
                    disabled={busy !== null}
                    onChange={(event) =>
                      onTargetProfileChange(
                        target.id,
                        event.target.value as LineAccessProfileKey,
                      )
                    }
                    value={profileDraft}
                  >
                    {profileOptions.map((profile) => (
                      <option key={profile.value} value={profile.value}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                  {target.approved &&
                  profileDraft !== target.access_profile_key ? (
                    <Button
                      className="w-full"
                      disabled={busy !== null}
                      onClick={() => onUpdateTargetProfile(target)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      บันทึกสิทธิ์
                    </Button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                    ความพร้อม
                  </p>
                  <StatusText ok={target.approved} text="อนุมัติ" />
                  <StatusText ok={target.enabled} text="เปิดรับ" />
                  <StatusText ok={!missingBriefAction} text="รับแผนแจ้งเตือน" />
                  <StatusText
                    ok={target.allowed_report_keys.length > 0}
                    text="มีสิทธิ์รายงาน"
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-theme-xs text-gray-500 dark:text-gray-400">
                    ส่งผ่าน
                  </p>
                  <p className="mt-1 text-theme-sm text-gray-700 dark:text-gray-300">
                    {channel?.display_name ?? "ยังไม่ได้ผูก OA"}
                  </p>
                  <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                    {formatLineTargetSource(target.source)} · ล่าสุด{" "}
                    {target.last_delivery_at
                      ? formatDateTime(target.last_delivery_at)
                      : "ยังไม่เคยส่ง"}
                  </p>
                </div>
                <RecipientEstimateCell
                  busy={busy}
                  onSave={(estimate) =>
                    onUpdateRecipientEstimate(target, estimate)
                  }
                  target={target}
                />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {!target.approved ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() => onApproveTarget(target)}
                    size="sm"
                    type="button"
                  >
                    อนุมัติ
                  </Button>
                ) : (
                  <Button
                    disabled={busy !== null}
                    onClick={() => onToggleTarget(target)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {target.enabled ? "ปิดรับ" : "เปิดรับ"}
                  </Button>
                )}
                {target.approved && missingBriefAction ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() => onEnableMorningBriefAction(target)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    เปิดรับสรุปประจำวัน
                  </Button>
                ) : null}
                {target.approved && target.enabled ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() => onTestSendTarget(target)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {busy === `test-send-${target.id}`
                      ? "กำลังส่ง..."
                      : "ส่งทดสอบจริง"}
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden w-full overflow-x-auto lg:block">
        <table className="min-w-full">
          <thead>
            <tr className="border-y border-gray-100 dark:border-gray-800">
              {[
                "ผู้รับ",
                "สิทธิ์",
                "ความพร้อม",
                "ส่งผ่าน",
                "ประมาณการ",
                "จัดการ",
              ].map((label) => (
                <th className="py-3 pr-5 text-left sm:pr-6" key={label}>
                  <p className="font-medium text-gray-500 text-theme-xs dark:text-gray-400">
                    {label}
                  </p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {targets.map((target) => {
              const channel = target.line_channel_id
                ? channels.find((item) => item.id === target.line_channel_id)
                : null;
              const ready = isLineTargetReady(target, channels);
              const missingBriefAction = !target.allowed_actions.includes(
                "receive_morning_brief",
              );
              const profileDraft =
                targetProfileDrafts[target.id] ?? target.access_profile_key;
              return (
                <tr key={target.id}>
                  <td className="py-4 pr-5 sm:pr-6">
                    <div>
                      <p className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                        {target.display_name}
                      </p>
                      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                        {formatTargetType(target.target_type)} ·{" "}
                        <span className="font-mono">
                          {target.target_id_masked}
                        </span>
                      </p>
                    </div>
                  </td>
                  <td className="py-4 pr-5 sm:pr-6">
                    <div className="min-w-40 space-y-2">
                      <select
                        className="owner-v2-input"
                        disabled={busy !== null}
                        onChange={(event) =>
                          onTargetProfileChange(
                            target.id,
                            event.target.value as LineAccessProfileKey,
                          )
                        }
                        value={profileDraft}
                      >
                        {profileOptions.map((profile) => (
                          <option key={profile.value} value={profile.value}>
                            {profile.label}
                          </option>
                        ))}
                      </select>
                      {target.approved &&
                      profileDraft !== target.access_profile_key ? (
                        <Button
                          className="w-full"
                          disabled={busy !== null}
                          onClick={() => onUpdateTargetProfile(target)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          บันทึกสิทธิ์
                        </Button>
                      ) : null}
                    </div>
                  </td>
                  <td className="py-4 pr-5 sm:pr-6">
                    <div className="space-y-2">
                      <Badge
                        color={
                          ready
                            ? "success"
                            : target.approved
                              ? "warning"
                              : "error"
                        }
                      >
                        {ready
                          ? "พร้อมส่ง"
                          : target.approved
                            ? "ยังไม่ครบ"
                            : "รออนุมัติ"}
                      </Badge>
                      <div className="space-y-1">
                        <StatusText ok={target.approved} text="อนุมัติ" />
                        <StatusText ok={target.enabled} text="เปิดรับ" />
                        <StatusText
                          ok={!missingBriefAction}
                          text="รับแผนแจ้งเตือน"
                        />
                        <StatusText
                          ok={target.allowed_report_keys.length > 0}
                          text="มีสิทธิ์รายงาน"
                        />
                      </div>
                    </div>
                  </td>
                  <td className="py-4 pr-5 sm:pr-6">
                    <div>
                      <p className="text-theme-sm text-gray-700 dark:text-gray-300">
                        {channel?.display_name ?? "ยังไม่ได้ผูก OA"}
                      </p>
                      <p className="mt-1 text-theme-xs text-gray-500 dark:text-gray-400">
                        {formatLineTargetSource(target.source)} · ล่าสุด{" "}
                        {target.last_delivery_at
                          ? formatDateTime(target.last_delivery_at)
                          : "ยังไม่เคยส่ง"}
                      </p>
                    </div>
                  </td>
                  <td className="py-4 pr-5 sm:pr-6">
                    <RecipientEstimateCell
                      busy={busy}
                      onSave={(estimate) =>
                        onUpdateRecipientEstimate(target, estimate)
                      }
                      target={target}
                    />
                  </td>
                  <td className="py-4 pr-5 sm:pr-6">
                    <div className="flex min-w-36 flex-col gap-2">
                      {!target.approved ? (
                        <Button
                          disabled={busy !== null}
                          onClick={() => onApproveTarget(target)}
                          size="sm"
                          type="button"
                        >
                          อนุมัติ
                        </Button>
                      ) : (
                        <Button
                          disabled={busy !== null}
                          onClick={() => onToggleTarget(target)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {target.enabled ? "ปิดรับ" : "เปิดรับ"}
                        </Button>
                      )}
                      {target.approved && missingBriefAction ? (
                        <Button
                          disabled={busy !== null}
                          onClick={() => onEnableMorningBriefAction(target)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          เปิดรับสรุปประจำวัน
                        </Button>
                      ) : null}
                      {target.approved && target.enabled ? (
                        <Button
                          disabled={busy !== null}
                          onClick={() => onTestSendTarget(target)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {busy === `test-send-${target.id}`
                            ? "กำลังส่ง..."
                            : "ส่งทดสอบจริง"}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
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
    <div className="rounded-lg bg-gray-50 p-5 text-center dark:bg-white/[0.02]">
      <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
        {title}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500 dark:text-gray-400">
        {detail}
      </p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

function ReadinessItem({
  check,
}: {
  check: { ok: boolean; label: string; detail: string };
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
            check.ok
              ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400"
              : "bg-warning-50 text-warning-600 dark:bg-warning-500/15 dark:text-warning-400"
          }`}
        >
          <CheckCircleIcon className="size-4" />
        </span>
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {check.label}
          </p>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {check.detail}
          </p>
        </div>
      </div>
    </div>
  );
}

function LineSetupGuide({
  checks,
  quotaSummary,
}: {
  checks: Array<{ ok: boolean; label: string; detail: string }>;
  quotaSummary: { knownRecipients: number; unknownTargets: number };
}) {
  const hasLineOa = Boolean(
    checks.find((check) => check.label === "มี LINE OA")?.ok,
  );
  const hasSendSecret = Boolean(
    checks.find((check) => check.label === "มีรหัสส่งข้อความ")?.ok,
  );
  const hasWebhookSecret = Boolean(
    checks.find((check) => check.label === "มีรหัสรับ Webhook")?.ok,
  );
  const hasReadyTarget = Boolean(
    checks.find((check) => check.label === "มีผู้รับพร้อมส่ง")?.ok,
  );
  const guideItems = [
    {
      done: hasLineOa,
      text: hasLineOa
        ? "มี OA ให้ใช้แล้ว"
        : "เพิ่ม LINE OA ของร้านหรือ OA กลางก่อน",
      title: "1. เพิ่ม OA",
    },
    {
      done: hasSendSecret && hasWebhookSecret,
      text:
        hasSendSecret && hasWebhookSecret
          ? "รหัสส่งและรหัส Webhook พร้อม"
          : "บันทึกรหัสส่งข้อความและรหัสรับ Webhook ให้ครบ",
      title: "2. บันทึกรหัส",
    },
    {
      done: hasReadyTarget,
      text: hasReadyTarget
        ? "มีผู้รับพร้อมรับรายงานแล้ว"
        : "อนุมัติผู้รับ เปิดรับสรุป และตรวจสิทธิ์รายงาน",
      title: "3. ผู้รับพร้อมส่ง",
    },
    {
      done: false,
      text: `ส่งทดสอบใช้โควต้าจริง ตอนนี้คาดการณ์ ${formatEstimatedMonthlyMessages(
        quotaSummary,
      )}`,
      title: "4. ทดสอบกับทีม",
      warning: true,
    },
  ];

  return (
    <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
            ลำดับตั้งค่า LINE ที่ปลอดภัย
          </h4>
          <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
            ทำตามลำดับนี้ก่อนเปิดแผนแจ้งเตือนให้ลูกค้าจริง
          </p>
        </div>
        <Badge color={hasReadyTarget ? "success" : "warning"}>
          {hasReadyTarget ? "พร้อมใช้งาน" : "ยังต้องตรวจ"}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {guideItems.map((item) => (
          <div
            className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]"
            key={item.title}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                {item.title}
              </p>
              <Badge
                color={
                  item.warning ? "warning" : item.done ? "success" : "warning"
                }
                size="sm"
              >
                {item.warning ? "ระวัง" : item.done ? "พร้อม" : "ต้องดู"}
              </Badge>
            </div>
            <p className="text-sm leading-6 text-gray-700 dark:text-gray-300">
              {item.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusText({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p
      className={`text-theme-xs ${
        ok
          ? "text-success-600 dark:text-success-400"
          : "text-gray-500 dark:text-gray-400"
      }`}
    >
      {ok ? "พร้อม" : "ยังไม่ครบ"} · {text}
    </p>
  );
}

function NextAction({
  href,
  ok,
  text,
  title,
}: {
  href: string;
  ok: boolean;
  text: string;
  title: string;
}) {
  return (
    <Link
      className="block rounded-lg bg-gray-50 p-3 transition hover:bg-brand-50 dark:bg-white/[0.02] dark:hover:bg-brand-500/10"
      href={href}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </p>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {text}
          </p>
        </div>
        <Badge color={ok ? "success" : "warning"}>
          {ok ? "ต่อได้" : "รอก่อน"}
        </Badge>
      </div>
    </Link>
  );
}

function LineSetupSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel>
        <PanelHeader title="กำลังโหลด LINE OA" />
        <PanelBody spaced>
          <MiniSkeleton />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="กำลังโหลดสถานะ" />
        <PanelBody spaced>
          <MiniSkeleton />
        </PanelBody>
      </Panel>
    </div>
  );
}

function MiniSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-4 w-2/3 rounded bg-gray-100 dark:bg-gray-800" />
      <div className="h-11 rounded-lg bg-gray-100 dark:bg-gray-800" />
      <div className="h-11 rounded-lg bg-gray-100 dark:bg-gray-800" />
    </div>
  );
}

function buildReadinessChecks({
  approvedTargets,
  channels,
  readyTargets,
  secretReadyChannels,
  totalTargets,
}: {
  approvedTargets: LineTargetRecord[];
  channels: LineChannelRecord[];
  readyTargets: LineTargetRecord[];
  secretReadyChannels: LineChannelRecord[];
  totalTargets: number;
}) {
  const sendReadyChannels = channels.filter(
    (channel) => channel.enabled && channel.channel_access_token_configured,
  );
  return [
    {
      ok: channels.length > 0,
      label: "มี LINE OA",
      detail: channels.length
        ? `${channels.length.toLocaleString("th-TH")} ช่องทางในร้านนี้`
        : "เพิ่ม LINE OA ก่อนบันทึกรหัสและรับผู้รับจาก Webhook",
    },
    {
      ok: sendReadyChannels.length > 0,
      label: "มีรหัสส่งข้อความ",
      detail: sendReadyChannels.length
        ? `${sendReadyChannels.length}/${channels.length} ช่องทางส่งข้อความได้`
        : "บันทึกรหัสส่งข้อความอย่างน้อย 1 ช่องทาง",
    },
    {
      ok: secretReadyChannels.length > 0,
      label: "มีรหัสรับ Webhook",
      detail: secretReadyChannels.length
        ? `${secretReadyChannels.length}/${channels.length} ช่องทางมีรหัสครบ`
        : "บันทึกรหัสรับ Webhook เพื่อให้ระบบรับรหัสผู้รับหรือรหัสกลุ่มเมื่อผู้รับเพิ่ม OA เป็นเพื่อนหรือส่งข้อความ",
    },
    {
      ok: readyTargets.length > 0,
      label: "มีผู้รับพร้อมส่ง",
      detail: readyTargets.length
        ? `${readyTargets.length}/${totalTargets} ผู้รับพร้อมรับรายงาน`
        : approvedTargets.length
          ? "ผู้รับอนุมัติแล้วแต่ยังติดรหัสส่งข้อความ สิทธิ์รับแจ้งเตือน หรือสิทธิ์รายงาน"
          : "อนุมัติผู้รับ LINE อย่างน้อย 1 รายการก่อนเปิดแผนแจ้งเตือน",
    },
  ];
}

function isLineTargetReady(
  target: LineTargetRecord,
  channels: LineChannelRecord[],
) {
  const channel = target.line_channel_id
    ? channels.find((item) => item.id === target.line_channel_id)
    : null;
  return Boolean(
    target.approved &&
    target.enabled &&
    target.allowed_actions.includes("receive_morning_brief") &&
    target.allowed_report_keys.length > 0 &&
    channel?.enabled &&
    channel.channel_access_token_configured,
  );
}

function formatProfileKey(profileKey: LineAccessProfileKey) {
  return (
    profileOptions.find((profile) => profile.value === profileKey)?.label ??
    profileKey
  );
}

function formatTargetType(targetType: LineTargetRecord["target_type"]) {
  if (targetType === "group") {
    return "กลุ่ม";
  }
  if (targetType === "room") {
    return "ห้องแชท";
  }
  return "รายคน";
}

function TargetGroup({
  children,
  targets,
  title,
}: {
  children: React.ReactNode;
  targets: LineTargetRecord[];
  title: string;
}) {
  return (
    <div className="mt-5">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h4>
        <Badge color="light" size="sm">
          {targets.length} รายการ
        </Badge>
      </div>
      {targets.length ? (
        children
      ) : (
        <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-theme-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {title === "ผู้บริหารรายคน"
            ? "ยังไม่มีผู้บริหารรายคนที่อนุมัติแล้ว"
            : title === "กลุ่มทีมงาน"
              ? "ยังไม่มีกลุ่มทีมงานที่อนุมัติแล้ว"
              : "ไม่มีปลายทางรออนุมัติ"}
        </div>
      )}
    </div>
  );
}

function calculateQuotaSummary(targets: LineTargetRecord[]) {
  return targets.reduce(
    (summary, target) => {
      const estimate = getRecipientEstimate(target);
      if (estimate === null) {
        return {
          knownRecipients: summary.knownRecipients,
          unknownTargets: summary.unknownTargets + 1,
        };
      }
      return {
        knownRecipients: summary.knownRecipients + estimate,
        unknownTargets: summary.unknownTargets,
      };
    },
    { knownRecipients: 0, unknownTargets: 0 },
  );
}

function RecipientEstimateCell({
  busy,
  onSave,
  target,
}: {
  busy: string | null;
  onSave: (estimate: number | null) => void;
  target: LineTargetRecord;
}) {
  const [value, setValue] = useState(
    target.recipient_count_estimate?.toString() ?? "",
  );
  useEffect(() => {
    setValue(target.recipient_count_estimate?.toString() ?? "");
  }, [target.recipient_count_estimate]);
  const parsed = Number(value);
  const valid = value === "" || (!Number.isNaN(parsed) && parsed >= 1);
  return (
    <div className="flex flex-col gap-1">
      <input
        className="owner-v2-input w-24"
        disabled={busy !== null}
        inputMode="numeric"
        onChange={(event) => setValue(event.target.value)}
        placeholder={target.target_type === "user" ? "1" : "เช่น 10"}
        type="number"
        value={value}
      />
      <button
        className="text-theme-xs text-brand-600 hover:underline disabled:opacity-50"
        disabled={
          busy !== null ||
          !valid ||
          value === (target.recipient_count_estimate?.toString() ?? "")
        }
        onClick={() => onSave(value === "" ? null : parsed)}
        type="button"
      >
        บันทึกโควต้า
      </button>
    </div>
  );
}

function getRecipientEstimate(target: LineTargetRecord) {
  if (typeof target.recipient_count_estimate === "number") {
    return target.recipient_count_estimate;
  }
  return target.target_type === "user" ? 1 : null;
}

function formatLineChannelSource(channel: LineChannelRecord) {
  if (channel.source === "env") {
    return "ตั้งค่าจากเครื่องแม่ข่าย";
  }
  return channel.scope === "owner_shared"
    ? "เพิ่มจากหน้าแอดมิน · ใช้ร่วมหลายร้าน"
    : "เพิ่มจากหน้าแอดมิน";
}

function formatLineTargetSource(source: LineTargetRecord["source"]) {
  const labels: Record<LineTargetRecord["source"], string> = {
    env_fallback: "ตั้งค่าจากเครื่องแม่ข่าย",
    manual: "เพิ่มเอง",
    webhook: "รับจาก Webhook",
  };
  return labels[source] ?? "ไม่ทราบที่มา";
}

function toLineTechnicalMessage(error: unknown) {
  return error instanceof Error ? error.message : "ไม่พบรายละเอียด";
}

function formatEstimatedMonthlyMessages(summary: {
  knownRecipients: number;
  unknownTargets: number;
}) {
  const knownMessages = summary.knownRecipients * 30;
  if (summary.unknownTargets) {
    return knownMessages === 0
      ? "รอระบุจำนวนผู้รับ"
      : `${knownMessages.toLocaleString("th-TH")}+ ข้อความ/เดือน`;
  }
  return `${knownMessages.toLocaleString("th-TH")} ข้อความ/เดือน`;
}
