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
import { AlertIcon, CheckCircleIcon, InfoIcon, PlusIcon } from "@/icons";
import { isAbortError, ownerV2Fetch } from "./api";
import type { OwnerV2LineSetupPayload } from "./types";

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
    | { status: "error"; message: string }
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

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      setMessage(null);
      try {
        const data = await ownerV2Fetch<OwnerV2LineSetupPayload>(
          `/api/owner/tenants/${encodeURIComponent(tenantId)}/line-setup`,
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        setState({ status: "success", data });
        setSecretForm((current) => ({
          ...current,
          channelId:
            current.channelId && data.channels.some((item) => item.id === current.channelId)
              ? current.channelId
              : data.channels[0]?.id ?? "",
          channelAccessToken: "",
          channelSecret: "",
        }));
        setAssignmentForm((current) => ({
          ...current,
          lineChannelId:
            current.lineChannelId &&
            data.channels.some((item) => item.id === current.lineChannelId)
              ? current.lineChannelId
              : data.channels[0]?.id ?? "",
        }));
        setTargetProfileDrafts((current) => {
          const next = { ...current };
          for (const target of data.targets) {
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
            error instanceof Error ? error.message : "โหลดการตั้งค่า LINE ไม่สำเร็จ",
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
    busy !== null || state.status !== "success" || channelForm.displayName.trim().length < 2;
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
      return;
    }
    setBusy("create-channel");
    setMessage(null);
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
        text: "เพิ่ม LINE OA แล้ว ขั้นต่อไปบันทึก token ส่งข้อความและ secret รับ webhook",
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "สร้าง LINE OA ไม่สำเร็จ กรุณาลองใหม่",
      });
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
          ? "กรอก token ส่งข้อความหรือ secret รับ webhook อย่างน้อย 1 ค่า"
          : "เลือก LINE OA ก่อนบันทึก token/secret",
      });
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
        text: "บันทึก token/secret แล้ว ระบบจะไม่แสดงค่าลับกลับบนหน้าจอ",
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error
            ? error.message
            : "บันทึก token/secret ไม่สำเร็จ กรุณาตรวจ encryption key หรือสิทธิ์ผู้ดูแล",
      });
    } finally {
      setBusy(null);
    }
  }

  async function toggleChannel(channel: LineChannelRecord) {
    setBusy(`channel-${channel.id}`);
    setMessage(null);
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
        text:
          error instanceof Error
            ? error.message
            : "อัปเดต LINE OA ไม่สำเร็จ กรุณาลองใหม่",
      });
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
            : data.find((item) => !item.assigned_tenant_ids.includes(tenantId))
                ?.source_target_id ?? "",
      }));
    } catch (error) {
      setRecipientsState({
        status: "error",
        message:
          error instanceof Error ? error.message : "โหลดคลังผู้รับ LINE ไม่สำเร็จ",
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
      return;
    }
    setBusy("assign-recipient");
    setMessage(null);
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
        text:
          error instanceof Error
            ? error.message
            : "เพิ่มผู้รับ LINE เข้าร้านไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  async function approveTarget(target: LineTargetRecord) {
    const profileKey = targetProfileDrafts[target.id] ?? target.access_profile_key;
    setBusy(`approve-${target.id}`);
    setMessage(null);
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
        text:
          error instanceof Error ? error.message : "อนุมัติผู้รับ LINE ไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  async function updateTargetProfile(target: LineTargetRecord) {
    const profileKey = targetProfileDrafts[target.id] ?? target.access_profile_key;
    if (profileKey === target.access_profile_key) {
      setMessage({
        tone: "warning",
        text: "สิทธิ์ผู้รับยังไม่เปลี่ยน ไม่ต้องบันทึกซ้ำ",
      });
      return;
    }
    setBusy(`profile-${target.id}`);
    setMessage(null);
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
        text:
          error instanceof Error ? error.message : "อัปเดตสิทธิ์ผู้รับไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  async function toggleTarget(target: LineTargetRecord) {
    setBusy(`target-${target.id}`);
    setMessage(null);
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
        text:
          error instanceof Error ? error.message : "อัปเดตผู้รับ LINE ไม่สำเร็จ",
      });
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
        text:
          error instanceof Error
            ? error.message
            : "เปิดสิทธิ์รับแผนแจ้งเตือนไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  if (state.status === "loading") {
    return <LineSetupSkeleton />;
  }

  if (state.status === "error") {
    return (
      <Panel>
        <PanelBody>
          <Notice
            text={`${state.message} ลองรีเฟรชหน้านี้ หรือตรวจ session ผู้ดูแล`}
            title="โหลด LINE OA ไม่สำเร็จ"
            tone="error"
          />
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

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5 sm:space-y-6">
          <Panel>
            <PanelHeader
              action={
                <Badge color={readinessTone}>
                  {readyCheckCount}/{readinessChecks.length} พร้อม
                </Badge>
              }
              description="ตั้งค่า LINE OA, บันทึก token/secret, แล้วเพิ่มผู้รับเข้าร้านก่อนเปิดแผนแจ้งเตือน"
              title={`LINE OA ของ ${state.data.tenant.name}`}
            />
            <PanelBody>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Fact
                  label="LINE OA ส่งได้"
                  tone={state.data.readiness.send_ready_channels > 0 ? "success" : "warning"}
                  value={`${state.data.readiness.send_ready_channels}/${state.data.readiness.total_channels}`}
                />
                <Fact
                  label="ผู้รับพร้อมส่ง"
                  tone={state.data.readiness.ready_targets > 0 ? "success" : "warning"}
                  value={`${state.data.readiness.ready_targets}/${state.data.readiness.total_targets}`}
                />
                <Fact
                  label="Token/secret พร้อม"
                  tone={secretReadyChannels.length > 0 ? "success" : "warning"}
                  value={`${secretReadyChannels.length}/${channels.length}`}
                />
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-2">
                {readinessChecks.map((check) => (
                  <ReadinessItem check={check} key={check.label} />
                ))}
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              description="เพิ่ม OA ของร้านหรือ OA กลาง แล้วเปิดใช้งานเฉพาะช่องทางที่พร้อมส่ง"
              title="ช่องทาง LINE OA"
            />
            <PanelBody className="space-y-5">
              <form
                className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_180px_120px_auto]"
                onSubmit={createChannel}
              >
                <Field label="ชื่อ LINE OA">
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
                <Field label="ขอบเขต">
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
                <Field label="สถานะ">
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
              </form>

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
            <PanelBody className="space-y-5">
              {targets.length ? (
                <TargetTable
                  busy={busy}
                  channels={channels}
                  onApproveTarget={approveTarget}
                  onEnableMorningBriefAction={enableMorningBriefAction}
                  onTargetProfileChange={(targetId, profileKey) =>
                    setTargetProfileDrafts((current) => ({
                      ...current,
                      [targetId]: profileKey,
                    }))
                  }
                  onToggleTarget={toggleTarget}
                  onUpdateTargetProfile={updateTargetProfile}
                  targetProfileDrafts={targetProfileDrafts}
                  targets={targets}
                />
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
                  detail="ให้ผู้รับเพิ่ม OA แล้วพิมพ์ test หรือเลือกผู้รับจากคลังที่มีอยู่"
                  title="ยังไม่มีผู้รับ LINE ในร้านนี้"
                />
              )}
            </PanelBody>
          </Panel>
        </div>

        <div className="space-y-5 sm:space-y-6">
          <Panel>
            <PanelHeader
              description="ระบบไม่แสดง token หรือ secret ที่บันทึกไว้กลับมาบนหน้าจอ"
              title="บันทึก token/secret"
            />
            <PanelBody>
              <form className="space-y-4" onSubmit={saveChannelSecrets}>
                <Field label="เลือก LINE OA">
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
                <Field label="Token ส่งข้อความ">
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
                <Field label="Secret รับ webhook">
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
                  บันทึก token/secret
                </Button>
                <p className="text-theme-xs leading-5 text-gray-500 dark:text-gray-400">
                  ถ้าเปลี่ยนค่า ให้กรอกเฉพาะช่องที่ต้องการอัปเดตแล้วกดบันทึก
                </p>
              </form>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader
              action={
                recipientsState.status === "success" ? (
                  <Badge color="info">{selectableRecipients.length} เลือกได้</Badge>
                ) : null
              }
              description="โหลดเฉพาะตอนต้องเพิ่มผู้รับ เพื่อลดเวลาเปิดหน้า LINE"
              title="เพิ่มผู้รับจากคลัง"
            />
            <PanelBody>
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
                <Notice
                  text={`${recipientsState.message} ลองโหลดใหม่ หรือให้ผู้รับพิมพ์ test ใน LINE OA อีกครั้ง`}
                  title="โหลดคลังผู้รับไม่สำเร็จ"
                  tone="error"
                />
              ) : null}
              {recipientsState.status === "success" ? (
                <form className="space-y-4" onSubmit={assignRecipient}>
                  <Field label="ผู้รับ">
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
                          {recipient.display_name} · {recipient.target_id_masked}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="ส่งผ่าน LINE OA">
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
                  <Field label="สิทธิ์เริ่มต้น">
                    <select
                      className="owner-v2-input"
                      onChange={(event) =>
                        setAssignmentForm((current) => ({
                          ...current,
                          profileKey: event.target.value as LineAccessProfileKey,
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

          <Panel>
            <PanelHeader
              description="ไปต่อเมื่อมีผู้รับพร้อมส่งแล้ว"
              title="ขั้นถัดไป"
            />
            <PanelBody className="space-y-3">
              <NextAction
                href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/permissions`}
                ok={readyTargets.length > 0}
                text={
                  readyTargets.length
                    ? "ตรวจสิทธิ์รายงานตาม role ของผู้รับ"
                    : "อนุมัติผู้รับและเปิดรับแผนแจ้งเตือนก่อน"
                }
                title="สิทธิ์รายงาน"
              />
              <NextAction
                href={`/owner-v2/stores/${encodeURIComponent(tenantId)}/notifications`}
                ok={readyTargets.length > 0}
                text={
                  readyTargets.length
                    ? "ผูกผู้รับเข้ากับแผนแจ้งเตือนของร้าน"
                    : "ยังตั้งแผนส่งจริงไม่ได้ เพราะไม่มีผู้รับพร้อมส่ง"
                }
                title="แผนแจ้งเตือน"
              />
            </PanelBody>
          </Panel>
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
        detail="เริ่มจากเพิ่ม LINE OA ของร้าน แล้วบันทึก token ส่งข้อความและ secret รับ webhook"
        title="ยังไม่มี LINE OA"
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="w-full overflow-x-auto">
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
                    <p className="mt-1 font-mono text-theme-xs text-gray-500 dark:text-gray-400">
                      {channel.source === "env" ? "ตั้งค่าจาก environment" : channel.id}
                    </p>
                  </div>
                </td>
                <td className="py-4 pr-5 sm:pr-6">
                  <Badge color={channel.scope === "owner_shared" ? "info" : "light"}>
                    {channel.scope === "owner_shared" ? "OA กลาง" : "ของร้านนี้"}
                  </Badge>
                </td>
                <td className="py-4 pr-5 sm:pr-6">
                  <div className="space-y-1">
                    <StatusText
                      ok={channel.channel_access_token_configured}
                      text="token ส่งข้อความ"
                    />
                    <StatusText
                      ok={channel.channel_secret_configured}
                      text="secret รับ webhook"
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
    </div>
  );
}

function TargetTable({
  busy,
  channels,
  onApproveTarget,
  onEnableMorningBriefAction,
  onTargetProfileChange,
  onToggleTarget,
  onUpdateTargetProfile,
  targetProfileDrafts,
  targets,
}: {
  busy: string | null;
  channels: LineChannelRecord[];
  onApproveTarget: (target: LineTargetRecord) => void;
  onEnableMorningBriefAction: (target: LineTargetRecord) => void;
  onTargetProfileChange: (targetId: string, profileKey: LineAccessProfileKey) => void;
  onToggleTarget: (target: LineTargetRecord) => void;
  onUpdateTargetProfile: (target: LineTargetRecord) => void;
  targetProfileDrafts: Record<string, LineAccessProfileKey>;
  targets: LineTargetRecord[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="w-full overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-y border-gray-100 dark:border-gray-800">
              {["ผู้รับ", "สิทธิ์", "ความพร้อม", "ส่งผ่าน", "จัดการ"].map(
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
                        <span className="font-mono">{target.target_id_masked}</span>
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
                      {target.approved && profileDraft !== target.access_profile_key ? (
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
                      <Badge color={ready ? "success" : target.approved ? "warning" : "error"}>
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
                        {target.source} · ล่าสุด{" "}
                        {target.last_delivery_at
                          ? formatDateTime(target.last_delivery_at)
                          : "ยังไม่เคยส่ง"}
                      </p>
                    </div>
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

function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-4 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 ${className}`}
    >
      {children}
    </section>
  );
}

function PanelHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          {title}
        </h3>
        {description ? (
          <p className="mt-1 max-w-2xl text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function PanelBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={className || "space-y-5"}>{children}</div>;
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function Fact({
  label,
  tone = "light",
  value,
}: {
  label: string;
  tone?: "success" | "warning" | "error" | "light";
  value: string;
}) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <div className="flex items-start justify-between gap-3">
        <p className="text-theme-xs text-gray-500 dark:text-gray-400">{label}</p>
        {tone !== "light" ? (
          <Badge color={tone} size="sm">
            {tone === "success"
              ? "ปกติ"
              : tone === "warning"
                ? "ต้องดู"
                : "ผิดพลาด"}
          </Badge>
        ) : null}
      </div>
      <p className="mt-2 break-words text-theme-xl font-semibold text-gray-800 dark:text-white/90">
        {value}
      </p>
    </div>
  );
}

function Notice({
  text,
  title,
  tone,
}: {
  text: string;
  title: string;
  tone: "success" | "warning" | "error";
}) {
  const toneConfig = {
    success: {
      className:
        "border-success-500 bg-success-50 dark:border-success-500/30 dark:bg-success-500/15",
      icon: <CheckCircleIcon className="size-6 fill-current" />,
      iconClassName: "text-success-500",
    },
    warning: {
      className:
        "border-warning-500 bg-warning-50 dark:border-warning-500/30 dark:bg-warning-500/15",
      icon: <InfoIcon className="size-6 fill-current" />,
      iconClassName: "text-warning-500 dark:text-orange-400",
    },
    error: {
      className:
        "border-error-500 bg-error-50 dark:border-error-500/30 dark:bg-error-500/15",
      icon: <AlertIcon className="size-6 fill-current" />,
      iconClassName: "text-error-500",
    },
  }[tone];
  return (
    <div className={`rounded-xl border p-4 ${toneConfig.className}`}>
      <div className="flex items-start gap-3">
        <div className={`-mt-0.5 shrink-0 ${toneConfig.iconClassName}`}>
          {toneConfig.icon}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
            {title}
          </p>
          <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {text}
          </p>
        </div>
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

function StatusText({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p
      className={`text-theme-xs ${
        ok ? "text-success-600 dark:text-success-400" : "text-gray-500 dark:text-gray-400"
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
        <Badge color={ok ? "success" : "warning"}>{ok ? "ต่อได้" : "รอก่อน"}</Badge>
      </div>
    </Link>
  );
}

function LineSetupSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel>
        <PanelHeader title="กำลังโหลด LINE OA" />
        <PanelBody>
          <MiniSkeleton />
        </PanelBody>
      </Panel>
      <Panel>
        <PanelHeader title="กำลังโหลดสถานะ" />
        <PanelBody>
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
        : "เพิ่ม LINE OA ก่อนบันทึก token และรับผู้รับจาก webhook",
    },
    {
      ok: sendReadyChannels.length > 0,
      label: "มี token ส่งข้อความ",
      detail: sendReadyChannels.length
        ? `${sendReadyChannels.length}/${channels.length} ช่องทางส่งข้อความได้`
        : "บันทึก token ส่งข้อความอย่างน้อย 1 ช่องทาง",
    },
    {
      ok: secretReadyChannels.length > 0,
      label: "มี secret รับ webhook",
      detail: secretReadyChannels.length
        ? `${secretReadyChannels.length}/${channels.length} ช่องทางมี token และ secret`
        : "บันทึก secret รับ webhook เพื่อให้ระบบรับ userId หรือ groupId หลังผู้รับพิมพ์ test",
    },
    {
      ok: readyTargets.length > 0,
      label: "มีผู้รับพร้อมส่ง",
      detail: readyTargets.length
        ? `${readyTargets.length}/${totalTargets} ผู้รับพร้อมรับรายงาน`
        : approvedTargets.length
          ? "ผู้รับอนุมัติแล้วแต่ยังติด token, สิทธิ์รับแจ้งเตือน หรือสิทธิ์รายงาน"
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
  return profileOptions.find((profile) => profile.value === profileKey)?.label ?? profileKey;
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

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(date);
}
