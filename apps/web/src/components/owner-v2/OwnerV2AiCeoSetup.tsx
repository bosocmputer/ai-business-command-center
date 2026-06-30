"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Badge from "@/components/ui/badge/Badge";
import Button from "@/components/ui/button/Button";
import { isAbortError, ownerV2Fetch } from "./api";
import type {
  OwnerV2AiCeoDryRunResult,
  OwnerV2AiCeoSetupStatus,
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

type AiCeoState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: OwnerV2AiCeoSetupStatus };

type MessageState = {
  tone: "success" | "warning" | "error" | "info";
  text: string;
};

type BusyState = "save" | "key" | "models" | "dry-run" | `item:${string}` | null;

type AiCeoModelCatalogItem = OwnerV2AiCeoSetupStatus["model_catalog"][number];

type ModelAdminGuide = {
  bestFor: string;
  strengths: string[];
  tradeoffs: string[];
  recommendation: string;
};

export default function OwnerV2AiCeoSetup({ tenantId }: { tenantId: string }) {
  const [state, setState] = useState<AiCeoState>({ status: "loading" });
  const [message, setMessage] = useState<MessageState | null>(null);
  const [busy, setBusy] = useState<BusyState>(null);
  const [dryRun, setDryRun] = useState<OwnerV2AiCeoDryRunResult | null>(null);
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [scheduledDate, setScheduledDate] = useState(todayDateInput());
  const [form, setForm] = useState({
    ai_enabled: false,
    shadow_mode_enabled: true,
    advisor_name: "AI CEO",
    business_type: "retail",
    selected_model_id: "qwen/qwen3.7-max",
    key_mode: "system_default",
    daily_token_budget: 80000,
    monthly_token_budget: 2000000,
    daily_cost_budget_usd: 2,
    monthly_cost_budget_usd: 60,
    prompt_text: "",
  });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: "loading" });
      try {
        const data = await ownerV2Fetch<OwnerV2AiCeoSetupStatus>(
          `/api/owner/tenants/${encodeURIComponent(tenantId)}/ai-ceo/config`,
          { signal },
        );
        if (signal?.aborted) {
          return;
        }
        setState({ status: "success", data });
        setForm(formFromStatus(data));
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "โหลดสถานะ AI CEO ไม่สำเร็จ",
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
  const selectedModel = statusData?.model_catalog.find(
    (model) => model.model_id === form.selected_model_id,
  );
  const canUseAi = Boolean(
    statusData?.plan_eligible && statusData.encryption_configured,
  );
  const canSave = Boolean(form.prompt_text.trim().length >= 80 && canUseAi);
  const canDryRun = Boolean(
    statusData?.plan_eligible &&
      statusData.encryption_configured &&
      statusData.key_configured &&
      form.prompt_text.trim().length >= 80,
  );

  async function saveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusData || busy !== null) {
      return;
    }
    if (!canSave) {
      setMessage({
        tone: "warning",
        text: "ตรวจแผนร้าน, AI_BCC_SECRET_KEY และ prompt ให้ครบก่อนบันทึก",
      });
      return;
    }

    setBusy("save");
    setMessage(null);
    try {
      const next = await ownerV2Fetch<OwnerV2AiCeoSetupStatus>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/ai-ceo/config`,
        {
          method: "PUT",
          body: {
            ...form,
            selected_model_id: form.selected_model_id,
            key_mode: form.key_mode,
          },
        },
      );
      setState({ status: "success", data: next });
      setForm(formFromStatus(next));
      setMessage({ tone: "success", text: "บันทึก AI CEO config แล้ว" });
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error ? error.message : "บันทึก AI CEO config ไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusData || busy !== null) {
      return;
    }
    if (openRouterKey.trim().length < 20) {
      setMessage({ tone: "warning", text: "กรอก OpenRouter API key ก่อนบันทึก" });
      return;
    }

    setBusy("key");
    setMessage(null);
    try {
      const next = await ownerV2Fetch<OwnerV2AiCeoSetupStatus>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/ai-ceo/openrouter-key`,
        {
          method: "PUT",
          body: { api_key: openRouterKey.trim() },
        },
      );
      setOpenRouterKey("");
      setState({ status: "success", data: next });
      setMessage({
        tone: "success",
        text: "บันทึก OpenRouter key แบบ encrypted แล้ว",
      });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "บันทึก OpenRouter key ไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  async function syncModels() {
    if (busy !== null) {
      return;
    }
    setBusy("models");
    setMessage(null);
    try {
      const next = await ownerV2Fetch<OwnerV2AiCeoSetupStatus>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/ai-ceo/sync-models`,
        { method: "POST" },
      );
      setState({ status: "success", data: next });
      setMessage({ tone: "success", text: "อัปเดตรายการ model จาก OpenRouter แล้ว" });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "อัปเดต model ไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  async function runDryRun() {
    if (busy !== null || !statusData) {
      return;
    }
    if (!canDryRun) {
      setMessage({
        tone: "warning",
        text: "ต้องมีแผนที่รองรับ, encryption, API key และ prompt ก่อน dry-run",
      });
      return;
    }

    setBusy("dry-run");
    setMessage(null);
    setDryRun(null);
    try {
      const result = await ownerV2Fetch<OwnerV2AiCeoDryRunResult>(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/ai-ceo/dry-run`,
        {
          method: "POST",
          body: { scheduled_date: scheduledDate || undefined },
        },
      );
      setDryRun(result);
      setMessage({
        tone: result.ok ? "success" : "warning",
        text: result.ok
          ? "AI CEO dry-run สำเร็จ"
          : (result.safe_error_message ?? "AI CEO dry-run ไม่สำเร็จ"),
      });
      await load();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "AI CEO dry-run ไม่สำเร็จ",
      });
      await load().catch(() => null);
    } finally {
      setBusy(null);
    }
  }

  async function updateItemStatus(itemId: string, status: string) {
    if (busy !== null) {
      return;
    }
    setBusy(`item:${itemId}`);
    setMessage(null);
    try {
      await ownerV2Fetch(
        `/api/owner/tenants/${encodeURIComponent(tenantId)}/ai-ceo/items/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          body: { status },
        },
      );
      await load();
      setMessage({ tone: "success", text: "อัปเดตสถานะคำแนะนำแล้ว" });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "อัปเดตสถานะไม่สำเร็จ",
      });
    } finally {
      setBusy(null);
    }
  }

  const modelOptions = useMemo(
    () => statusData?.model_catalog ?? [],
    [statusData?.model_catalog],
  );

  if (state.status === "loading") {
    return <AiCeoSkeleton />;
  }

  if (state.status === "error") {
    return (
      <Panel>
        <PanelBody>
          <Notice tone="error" title="โหลด AI CEO ไม่สำเร็จ" text={state.message} />
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
  const selectedModelGuide = selectedModel ? modelAdminGuide(selectedModel) : null;

  return (
    <div className="space-y-5 sm:space-y-6">
      <Panel>
        <PanelHeader
          title="AI CEO / Business Advisor"
          description="ตั้งค่าบทบาท, prompt, OpenRouter model และงบใช้งานของร้านนี้"
          action={
            <Link
              className={secondaryActionClass}
              href={`/owner-v2/stores/${encodeURIComponent(tenantId)}?tab=setup`}
            >
              กลับการตั้งค่าร้าน
            </Link>
          }
        />
        <PanelBody spaced>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Fact
              label="Plan"
              tone={data.plan_eligible ? "success" : "warning"}
              value={data.tenant.planCode.toUpperCase()}
            />
            <Fact
              label="AI status"
              tone={data.profile.ai_enabled ? "success" : "light"}
              value={data.profile.ai_enabled ? "เปิดใช้งาน" : "ยังไม่เปิด"}
            />
            <Fact
              label="OpenRouter key"
              tone={data.key_configured ? "success" : "warning"}
              value={keySourceLabel(data.key_source)}
            />
            <Fact
              label="Encryption"
              tone={data.encryption_configured ? "success" : "error"}
              value={data.encryption_configured ? "พร้อม" : "ยังไม่พร้อม"}
            />
          </div>

          {!data.plan_eligible ? (
            <Notice
              tone="warning"
              title="แผนนี้ยังไม่เปิด AI CEO"
              text="AI CEO ใช้งานจริงในแผน Business และ Pro เพื่อคุมต้นทุนและ SLA ของ provider"
            />
          ) : null}
          {!data.encryption_configured ? (
            <Notice
              tone="error"
              title="ยังไม่มี AI_BCC_SECRET_KEY"
              text="ต้องตั้งค่า encryption secret บน server ก่อนบันทึก OpenRouter key หรือเปิด AI CEO"
            />
          ) : null}

          <AiCeoAdminGuide />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.55fr)]">
            <form
              className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
              onSubmit={saveConfig}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
                    บทบาทและ model
                  </h4>
                  <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                    Prompt นี้จะใช้กับร้านนี้เท่านั้น
                  </p>
                </div>
                <Badge color={selectedModel?.recommended_tier === "pro" ? "warning" : "success"}>
                  {selectedModel?.recommended_tier.toUpperCase() ?? "MODEL"}
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Field label="ชื่อผู้ช่วย">
                  <input
                    className="owner-v2-input"
                    disabled={!canUseAi || busy !== null}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        advisor_name: event.target.value,
                      }))
                    }
                    value={form.advisor_name}
                  />
                </Field>
                <Field label="ประเภทธุรกิจ">
                  <input
                    className="owner-v2-input"
                    disabled={!canUseAi || busy !== null}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        business_type: event.target.value,
                      }))
                    }
                    value={form.business_type}
                  />
                </Field>
                <Field label="OpenRouter model">
                  <select
                    className="owner-v2-input"
                    disabled={!canUseAi || busy !== null}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        selected_model_id: event.target.value,
                      }))
                    }
                    value={form.selected_model_id}
                  >
                    {modelOptions.map((model) => {
                      const disabled =
                        data.tenant.planCode !== "pro" &&
                        model.recommended_tier === "pro";
                      return (
                        <option
                          disabled={disabled}
                          key={model.model_id}
                          value={model.model_id}
                        >
                          {model.display_name} · {model.recommended_tier.toUpperCase()} · $
                          {formatPrice(model.price_input_per_m)}/$
                          {formatPrice(model.price_output_per_m)}
                        </option>
                      );
                    })}
                  </select>
                </Field>
                <Field label="API key mode">
                  <select
                    className="owner-v2-input"
                    disabled={!canUseAi || busy !== null}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        key_mode: event.target.value,
                      }))
                    }
                    value={form.key_mode}
                  >
                    <option value="system_default">ใช้ key กลางของระบบ</option>
                    <option value="tenant_override">ใช้ key เฉพาะร้านนี้</option>
                  </select>
                </Field>
              </div>

              {selectedModel ? (
                <div className="mt-4 rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-white/90">
                        {selectedModel.intelligence_label}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-gray-500 dark:text-gray-400">
                        {selectedModel.use_case} · context{" "}
                        {formatNumber(selectedModel.context_length)} tokens · input $
                        {formatPrice(selectedModel.price_input_per_m)}/M · output $
                        {formatPrice(selectedModel.price_output_per_m)}/M
                      </p>
                    </div>
                    <Badge color={modelCostTone(selectedModel)}>
                      {modelCostLabel(selectedModel)}
                    </Badge>
                  </div>
                  {selectedModelGuide ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                      <MiniDefinition
                        label="เหมาะกับ"
                        value={selectedModelGuide.bestFor}
                      />
                      <MiniDefinition
                        label="ข้อควรระวัง"
                        value={selectedModelGuide.tradeoffs[0] ?? "-"}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
                <Field label="Daily tokens">
                  <input
                    className="owner-v2-input"
                    disabled={!canUseAi || busy !== null}
                    min={1000}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        daily_token_budget: Number(event.target.value),
                      }))
                    }
                    type="number"
                    value={form.daily_token_budget}
                  />
                </Field>
                <Field label="Monthly tokens">
                  <input
                    className="owner-v2-input"
                    disabled={!canUseAi || busy !== null}
                    min={10000}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        monthly_token_budget: Number(event.target.value),
                      }))
                    }
                    type="number"
                    value={form.monthly_token_budget}
                  />
                </Field>
                <Field label="Daily USD">
                  <input
                    className="owner-v2-input"
                    disabled={!canUseAi || busy !== null}
                    min={0.01}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        daily_cost_budget_usd: Number(event.target.value),
                      }))
                    }
                    step="0.01"
                    type="number"
                    value={form.daily_cost_budget_usd}
                  />
                </Field>
                <Field label="Monthly USD">
                  <input
                    className="owner-v2-input"
                    disabled={!canUseAi || busy !== null}
                    min={0.1}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        monthly_cost_budget_usd: Number(event.target.value),
                      }))
                    }
                    step="0.01"
                    type="number"
                    value={form.monthly_cost_budget_usd}
                  />
                </Field>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                  <input
                    checked={form.ai_enabled}
                    className="mt-1"
                    disabled={!canUseAi || busy !== null}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        ai_enabled: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gray-800 dark:text-white/90">
                      เปิด AI CEO
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                      เปิดใช้หลังทดสอบ key และ prompt แล้ว
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                  <input
                    checked={form.shadow_mode_enabled}
                    className="mt-1"
                    disabled={!canUseAi || busy !== null}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        shadow_mode_enabled: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-gray-800 dark:text-white/90">
                      Shadow mode
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                      ให้ระบบสร้างคำแนะนำก่อนนำไปส่งจริง
                    </span>
                  </span>
                </label>
              </div>

              <div className="mt-4">
                <Field label="CEO prompt">
                  <textarea
                    className="owner-v2-input min-h-72"
                    disabled={!canUseAi || busy !== null}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        prompt_text: event.target.value,
                      }))
                    }
                    value={form.prompt_text}
                  />
                </Field>
              </div>

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                <Button disabled={busy !== null || !canSave} size="sm" type="submit">
                  {busy === "save" ? "กำลังบันทึก..." : "บันทึก AI CEO"}
                </Button>
                <Button
                  disabled={busy !== null}
                  onClick={() => void syncModels()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {busy === "models" ? "กำลังอัปเดต..." : "อัปเดต model"}
                </Button>
              </div>
            </form>

            <div className="space-y-4">
              <form
                className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
                onSubmit={saveKey}
              >
                <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
                  OpenRouter key
                </h4>
                <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
                  ช่องนี้เป็น write-only และไม่แสดงค่าที่บันทึกไว้
                </p>
                <div className="mt-4">
                  <Field
                    label="API key"
                    help={data.key_configured ? "กรอกเฉพาะเมื่อต้องการแทนที่ค่าเดิม" : undefined}
                  >
                    <input
                      autoComplete="new-password"
                      className="owner-v2-input"
                      disabled={!data.encryption_configured || busy !== null}
                      onChange={(event) => setOpenRouterKey(event.target.value)}
                      placeholder="sk-or-v1-..."
                      type="password"
                      value={openRouterKey}
                    />
                  </Field>
                </div>
                <Button
                  className="mt-4 w-full"
                  disabled={busy !== null || !data.encryption_configured}
                  size="sm"
                  type="submit"
                >
                  {busy === "key" ? "กำลังบันทึก..." : "บันทึก key เฉพาะร้าน"}
                </Button>
              </form>

              <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                <h4 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
                  Usage guardrail
                </h4>
                <div className="grid grid-cols-1 gap-3">
                  <Fact
                    label="Today"
                    value={`${formatNumber(data.usage.today_tokens)} tokens · $${formatPrice(data.usage.today_cost_usd)}`}
                  />
                  <Fact
                    label="This month"
                    value={`${formatNumber(data.usage.month_tokens)} tokens · $${formatPrice(data.usage.month_cost_usd)}`}
                  />
                  <Fact
                    label="Last dry-run"
                    value={formatDateTime(data.profile.last_dry_run_at)}
                  />
                  <Fact
                    label="Last status"
                    tone={data.profile.last_status === "failed" ? "error" : "light"}
                    value={data.profile.last_status ?? "-"}
                  />
                </div>
              </section>

              <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                <h4 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
                  Dry-run
                </h4>
                <Field label="จำลองวันที่">
                  <input
                    className="owner-v2-input"
                    disabled={busy !== null}
                    onChange={(event) => setScheduledDate(event.target.value)}
                    type="date"
                    value={scheduledDate}
                  />
                </Field>
                <Button
                  className="mt-4 w-full"
                  disabled={busy !== null || !canDryRun}
                  onClick={() => void runDryRun()}
                  size="sm"
                  type="button"
                >
                  {busy === "dry-run" ? "กำลังเรียก AI..." : "ทดสอบ AI CEO"}
                </Button>
              </section>
            </div>
          </div>
        </PanelBody>
      </Panel>

      <AiCeoModelGuide
        busy={busy}
        canUseAi={canUseAi}
        models={modelOptions}
        onSelect={(modelId) =>
          setForm((current) => ({ ...current, selected_model_id: modelId }))
        }
        selectedModelId={form.selected_model_id}
        tenantPlanCode={data.tenant.planCode}
      />

      {message ? (
        <Notice tone={message.tone} title="สถานะ AI CEO" text={message.text} />
      ) : null}

      {dryRun ? <AiCeoDryRunResultPanel result={dryRun} /> : null}

      <AiCeoInbox
        busy={busy}
        items={data.open_items}
        onUpdateStatus={(itemId, status) => void updateItemStatus(itemId, status)}
      />
    </div>
  );
}

function AiCeoAdminGuide() {
  const sections = [
    {
      title: "สถานะด้านบน",
      text: "ใช้เช็กความพร้อมก่อนเปิดจริง: plan ต้องเป็น Business/Pro, key ต้องพร้อม และ encryption ต้องพร้อม",
    },
    {
      title: "บทบาทและ prompt",
      text: "กำหนดตัวตน AI CEO ของร้านนั้น ๆ เช่น ธุรกิจคอนกรีตควรเน้นสต็อก/ลูกหนี้ ส่วนร้านอาหารอาจเน้นยอดขายรายวัน",
    },
    {
      title: "OpenRouter model",
      text: "เลือกสมดุลระหว่างความฉลาด ความเร็ว และต้นทุน ยิ่ง model ใหญ่ยิ่งเหมาะกับวิเคราะห์ยากแต่ราคาสูงกว่า",
    },
    {
      title: "API key mode",
      text: "Key กลางระบบคือใช้ key บริษัท ถ้าเลือก key เฉพาะร้าน ระบบจะใช้ key ของร้านนั้นและเก็บแบบ encrypted",
    },
    {
      title: "Usage guardrail",
      text: "เพดาน token และ USD ใช้กันไม่ให้บิล OpenRouter ไหล ถ้าเกินงบ AI จะหยุดและบันทึกสถานะ failed แบบปลอดภัย",
    },
    {
      title: "Shadow mode",
      text: "เปิดไว้เพื่อให้ AI วิเคราะห์และเก็บคำแนะนำ แต่ไม่แนบการ์ดใน LINE เหมาะกับช่วงทดลองก่อนส่งจริง",
    },
    {
      title: "Dry-run",
      text: "ทดสอบ prompt/model/key กับวันที่จำลองก่อนรอบจริง การกดทดสอบจะใช้ token จริงของ OpenRouter",
    },
    {
      title: "สิ่งที่ AI CEO แนะนำ",
      text: "เป็น inbox งานที่ AI สร้างจากรอบ dry-run หรือ scheduled run เพื่อให้ admin รับทราบหรือปิดงานได้",
    },
  ];

  return (
    <section className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
            คู่มือสำหรับ Admin
          </h4>
          <p className="mt-1 text-theme-sm leading-6 text-gray-500 dark:text-gray-400">
            ใช้ส่วนนี้เป็น checklist ก่อนเปิด AI CEO ให้ร้านจริง
          </p>
        </div>
        <Badge color="info">Admin guide</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {sections.map((section) => (
          <MiniDefinition
            key={section.title}
            label={section.title}
            value={section.text}
          />
        ))}
      </div>
    </section>
  );
}

function AiCeoModelGuide({
  busy,
  canUseAi,
  models,
  onSelect,
  selectedModelId,
  tenantPlanCode,
}: {
  busy: BusyState;
  canUseAi: boolean;
  models: AiCeoModelCatalogItem[];
  onSelect: (modelId: string) => void;
  selectedModelId: string;
  tenantPlanCode: string;
}) {
  return (
    <Panel>
      <PanelHeader
        title="คู่มือเลือก OpenRouter model"
        description="ราคาแสดงเป็น USD ต่อ 1M input/output tokens จาก catalog ล่าสุดของระบบ ส่วนคำแนะนำใช้สำหรับเลือก model ให้เหมาะกับงานของร้าน"
        action={<Badge color="info">{models.length} models</Badge>}
      />
      <PanelBody spaced>
        <Notice
          tone="info"
          title="เลือกแบบเร็ว"
          text="ร้านส่วนใหญ่เริ่มจาก Qwen3.7 Max ได้ ถ้าต้องคุมต้นทุนมากให้ใช้ Gemini Flash หรือ DeepSeek Flash ถ้าต้องวิเคราะห์ยากมากและยอมรับต้นทุนได้ให้ใช้กลุ่ม Pro"
        />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {models.map((model) => {
            const guide = modelAdminGuide(model);
            const disabledByPlan =
              tenantPlanCode !== "pro" && model.recommended_tier === "pro";
            const selected = model.model_id === selectedModelId;
            return (
              <article
                className={`rounded-xl border p-4 ${
                  selected
                    ? "border-brand-500 bg-brand-50 dark:border-brand-500/30 dark:bg-brand-500/10"
                    : "border-gray-200 dark:border-gray-800"
                }`}
                key={model.model_id}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge
                        color={
                          model.recommended_tier === "pro" ? "warning" : "success"
                        }
                      >
                        {model.recommended_tier.toUpperCase()}
                      </Badge>
                      <Badge color={modelCostTone(model)}>
                        {modelCostLabel(model)}
                      </Badge>
                      {selected ? <Badge color="info">เลือกอยู่</Badge> : null}
                    </div>
                    <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
                      {model.display_name}
                    </h4>
                    <p className="mt-1 break-all text-xs text-gray-500 dark:text-gray-400">
                      {model.model_id}
                    </p>
                  </div>
                  <Button
                    disabled={busy !== null || !canUseAi || disabledByPlan || selected}
                    onClick={() => onSelect(model.model_id)}
                    size="sm"
                    type="button"
                    variant={selected ? "outline" : "primary"}
                  >
                    {selected
                      ? "เลือกอยู่"
                      : disabledByPlan
                        ? "ต้องใช้ Pro"
                        : "เลือก model นี้"}
                  </Button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Fact label="Input" value={`$${formatPrice(model.price_input_per_m)}/M`} />
                  <Fact label="Output" value={`$${formatPrice(model.price_output_per_m)}/M`} />
                  <Fact
                    label="Context"
                    value={`${formatNumber(model.context_length)} tokens`}
                  />
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <MiniDefinition label="เหมาะกับ" value={guide.bestFor} />
                  <MiniList label="ข้อดี" values={guide.strengths} />
                  <MiniList label="ข้อควรระวัง" values={guide.tradeoffs} />
                  <MiniDefinition label="คำแนะนำ" value={guide.recommendation} />
                </div>
              </article>
            );
          })}
        </div>
      </PanelBody>
    </Panel>
  );
}

function MiniDefinition({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-sm leading-6 text-gray-700 dark:text-gray-300">
        {value}
      </p>
    </div>
  );
}

function MiniList({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 dark:bg-white/[0.02]">
      <p className="text-theme-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm leading-6 text-gray-700 dark:text-gray-300">
        {values.map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
    </div>
  );
}

function AiCeoDryRunResultPanel({
  result,
}: {
  result: OwnerV2AiCeoDryRunResult;
}) {
  return (
    <Panel>
      <PanelHeader
        title="ผล AI CEO ล่าสุด"
        description={result.response?.summary ?? result.safe_error_message ?? "ไม่มีข้อความสรุป"}
        action={
          <Badge color={result.ok ? "success" : "error"}>
            {result.ok ? "ผ่าน" : "ไม่ผ่าน"}
          </Badge>
        }
      />
      <PanelBody spaced>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Fact label="Checked" value={formatDateTime(result.checked_at)} />
          <Fact label="Latency" value={`${result.latency_ms} ms`} />
          <Fact
            label="Provider"
            value={result.provider_status?.toString() ?? "-"}
          />
          <Fact
            label="Tokens"
            value={`${formatNumber(result.run.input_tokens ?? 0)} / ${formatNumber(result.run.output_tokens ?? 0)}`}
          />
          <Fact
            label="Cost"
            value={`$${formatPrice(result.run.cost_estimate_usd ?? 0)}`}
          />
        </div>
        {result.response?.top_actions.length ? (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {result.response.top_actions.map((action, index) => (
              <div
                className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
                key={`${action.title}-${index}`}
              >
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h4 className="text-sm font-semibold text-gray-800 dark:text-white/90">
                    {action.title}
                  </h4>
                  <Badge color={severityTone(action.severity)}>
                    {action.severity}
                  </Badge>
                </div>
                <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
                  {action.reason}
                </p>
                <p className="mt-2 text-sm font-medium leading-6 text-gray-800 dark:text-white/90">
                  {action.recommended_action}
                </p>
              </div>
            ))}
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

function AiCeoInbox({
  busy,
  items,
  onUpdateStatus,
}: {
  busy: BusyState;
  items: OwnerV2AiCeoSetupStatus["open_items"];
  onUpdateStatus: (itemId: string, status: string) => void;
}) {
  return (
    <Panel>
      <PanelHeader
        title="สิ่งที่ AI CEO แนะนำ"
        description="รายการล่าสุดที่ยังไม่ได้ปิดงาน"
      />
      <PanelBody>
        {items.length ? (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                className="rounded-xl border border-gray-200 p-4 dark:border-gray-800"
                key={item.id}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge color={severityTone(item.severity)}>
                        {item.severity}
                      </Badge>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {formatDateTime(item.created_at)}
                      </span>
                    </div>
                    <h4 className="text-base font-semibold text-gray-800 dark:text-white/90">
                      {item.title}
                    </h4>
                    <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                      {item.reason}
                    </p>
                    <p className="mt-2 text-sm font-medium leading-6 text-gray-800 dark:text-white/90">
                      {item.recommended_action}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                    <Button
                      disabled={busy !== null}
                      onClick={() => onUpdateStatus(item.id, "acknowledged")}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      รับทราบ
                    </Button>
                    <Button
                      disabled={busy !== null}
                      onClick={() => onUpdateStatus(item.id, "resolved")}
                      size="sm"
                      type="button"
                    >
                      ปิดงาน
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Notice
            tone="info"
            title="ยังไม่มีคำแนะนำค้างอยู่"
            text="เมื่อ dry-run หรือรอบส่ง AI CEO สำเร็จ รายการที่ควรทำจะมาอยู่ตรงนี้"
          />
        )}
      </PanelBody>
    </Panel>
  );
}

function AiCeoSkeleton() {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="h-80 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
      <div className="h-52 animate-pulse rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]" />
    </div>
  );
}

function formFromStatus(data: OwnerV2AiCeoSetupStatus) {
  return {
    ai_enabled: data.profile.ai_enabled,
    shadow_mode_enabled: data.profile.shadow_mode_enabled,
    advisor_name: data.profile.advisor_name,
    business_type: data.profile.business_type,
    selected_model_id: data.profile.selected_model_id,
    key_mode: data.profile.key_mode,
    daily_token_budget: data.profile.daily_token_budget,
    monthly_token_budget: data.profile.monthly_token_budget,
    daily_cost_budget_usd: data.profile.daily_cost_budget_usd,
    monthly_cost_budget_usd: data.profile.monthly_cost_budget_usd,
    prompt_text: data.active_prompt?.prompt_text ?? defaultPrompt(data),
  };
}

function defaultPrompt(data: OwnerV2AiCeoSetupStatus) {
  return [
    `คุณคือ AI CEO / Business Advisor ของร้าน ${data.tenant.name}`,
    `ประเภทธุรกิจ: ${data.profile.business_type || "retail"}`,
    "อ่านข้อมูลจากรายงานที่ระบบอนุมัติแล้วเท่านั้น ไม่เดาข้อมูลนอกหลักฐาน",
    "ให้คำแนะนำเจ้าของร้านแบบสั้น ชัด เจาะจง และทำได้จริงในเช้าวันนั้น",
    "เน้นยอดขาย กำไร สต็อก ลูกหนี้ กระแสเงินสด ความผิดปกติ และสิ่งที่ควรตรวจสอบก่อน",
    "ถ้าข้อมูลไม่พอ ให้บอก caveat และเสนอข้อมูลที่ควรเก็บเพิ่ม",
  ].join("\n");
}

function keySourceLabel(source: OwnerV2AiCeoSetupStatus["key_source"]) {
  const labels: Record<OwnerV2AiCeoSetupStatus["key_source"], string> = {
    tenant_override: "Key เฉพาะร้าน",
    system_default: "Key กลางระบบ",
    env: "ENV",
    missing: "ยังไม่มี",
  };
  return labels[source];
}

function modelAdminGuide(model: AiCeoModelCatalogItem): ModelAdminGuide {
  const guides: Record<string, ModelAdminGuide> = {
    "anthropic/claude-opus-4.8": {
      bestFor: "วิเคราะห์ยากมาก, board memo, เคสที่ต้องอ่าน caveat และความเสี่ยงละเอียด",
      strengths: [
        "ให้เหตุผลลึกและระวังข้อจำกัดของข้อมูลดี",
        "เหมาะกับร้านใหญ่ที่ต้องการคำแนะนำเชิงบริหารจริงจัง",
      ],
      tradeoffs: [
        "ต้นทุนสูงมาก ไม่เหมาะกับ daily brief ทุกเช้าถ้ายังไม่พิสูจน์ ROI",
        "อาจใช้เวลานานกว่า model กลุ่ม Flash หรือ Business",
      ],
      recommendation:
        "ใช้เฉพาะร้าน Pro หรือรอบวิเคราะห์พิเศษ เช่น สรุปรายสัปดาห์/รายเดือน",
    },
    "openai/gpt-5.5": {
      bestFor: "ผู้ช่วยผู้บริหารแบบ premium ที่ต้องการคำตอบรอบด้านและสื่อสารดี",
      strengths: [
        "สมดุลทั้ง reasoning, business writing และการจัดลำดับ action",
        "เหมาะกับคำแนะนำที่ต้องอ่านง่ายสำหรับเจ้าของกิจการ",
      ],
      tradeoffs: [
        "ราคา output สูง ควรตั้ง daily/monthly budget ให้ชัด",
        "ไม่จำเป็นสำหรับร้านเล็กที่ต้องการ brief สั้นเท่านั้น",
      ],
      recommendation:
        "ใช้เมื่อร้านยอมจ่ายเพื่อคุณภาพคำแนะนำสูง หรือมีข้อมูลหลายรายงานให้วิเคราะห์",
    },
    "anthropic/claude-sonnet-4.6": {
      bestFor: "ค่า default ของร้าน Pro ที่อยากได้ความละเอียดโดยไม่ไปแพงสุด",
      strengths: [
        "อ่าน context ยาวและสรุปเหตุผลเป็นระบบ",
        "เหมาะกับการชี้ความเสี่ยงและข้อควรตรวจสอบก่อนตัดสินใจ",
      ],
      tradeoffs: [
        "ยังแพงกว่ากลุ่ม Business default",
        "ถ้าข้อมูลรายวันสั้นมาก อาจเกินความจำเป็น",
      ],
      recommendation:
        "ใช้กับร้านใหญ่ที่อยากได้ AI CEO จริงจัง แต่ยังต้องคุมต้นทุนกว่า Opus",
    },
    "google/gemini-3.1-pro-preview": {
      bestFor: "งาน context ยาวมาก หรือร้านที่มีข้อมูลหลายมิติในรอบเดียว",
      strengths: [
        "context ใหญ่ เหมาะกับการรวมหลายรายงาน",
        "ดีสำหรับ structured output และการอ่านข้อมูลจำนวนมาก",
      ],
      tradeoffs: [
        "เป็น preview จึงควร monitor คุณภาพและราคาเมื่อ provider เปลี่ยน",
        "อาจไม่ใช่ตัวเลือกแรกถ้างานคือ brief สั้นทุกเช้า",
      ],
      recommendation:
        "ใช้กับงาน long-context หรือทดลองเทียบคุณภาพก่อนเปิดให้ลูกค้าจริง",
    },
    "qwen/qwen3.7-max": {
      bestFor: "daily AI CEO สำหรับร้านส่วนใหญ่ที่ต้องการ cost/performance ดี",
      strengths: [
        "สมดุลราคาและคุณภาพ เหมาะกับรอบส่งเช้าประจำวัน",
        "context ใหญ่พอสำหรับ 10 รายงานและ business signals",
      ],
      tradeoffs: [
        "งานวิเคราะห์ซับซ้อนมากอาจไม่ละเอียดเท่ากลุ่ม Pro premium",
        "ควรดูผล dry-run หลังแก้ prompt สำคัญทุกครั้ง",
      ],
      recommendation:
        "แนะนำเป็นค่าเริ่มต้นของแผน Business และร้านที่เริ่มใช้ AI CEO จริง",
    },
    "deepseek/deepseek-v4-pro": {
      bestFor: "ร้านที่อยากได้ reasoning ดีแต่ยังต้องคุมต้นทุน",
      strengths: [
        "ราคาดีเมื่อเทียบกับความสามารถด้าน reasoning",
        "เหมาะกับ report synthesis และหาสัญญาณผิดปกติจากตัวเลข",
      ],
      tradeoffs: [
        "ควรตรวจ output format หลังเปลี่ยน prompt หรือ sync model",
        "style คำแนะนำอาจต้องจูน prompt ให้เข้าภาษาแบรนด์",
      ],
      recommendation:
        "ใช้เป็นทางเลือก Business เมื่ออยากลดต้นทุนจาก Qwen แต่ยังคงคุณภาพวิเคราะห์",
    },
    "x-ai/grok-4.3": {
      bestFor: "ทางเลือก high-context สำหรับร้านที่ต้องการลอง provider สำรอง",
      strengths: [
        "context ใหญ่และ output cost น่าสนใจ",
        "ใช้เป็น fallback เปรียบเทียบคุณภาพกับ Qwen/DeepSeek ได้",
      ],
      tradeoffs: [
        "style อาจสนทนามาก ต้องคุม prompt ให้ตอบเป็น action business",
        "ควร monitor ความสม่ำเสมอของคำตอบช่วงแรก",
      ],
      recommendation:
        "ใช้ทดลองกับร้าน pilot ก่อน หากผลดีค่อยเปิดเป็น option ให้ admin เลือก",
    },
    "mistralai/mistral-large-2512": {
      bestFor: "ข้อความธุรกิจแบบ structured ที่ต้องการราคากลางและ predictable",
      strengths: [
        "เหมาะกับสรุปเชิงโครงสร้างและภาษา business ตรงไปตรงมา",
        "ต้นทุนไม่แรงเท่ากลุ่ม Pro premium",
      ],
      tradeoffs: [
        "context สั้นกว่าหลายตัวในรายการนี้",
        "ไม่ใช่ตัวเลือกแรกถ้าต้องอ่านข้อมูลยาวมากหลายรอบ",
      ],
      recommendation:
        "ใช้กับร้านที่ข้อมูลไม่ใหญ่มากและต้องการ brief ที่เป็นระบบ",
    },
    "google/gemini-2.5-flash": {
      bestFor: "daily brief ราคาประหยัดและต้องการความเร็ว",
      strengths: [
        "เร็วและประหยัด เหมาะกับรอบส่งทุกวัน",
        "context ใหญ่ เหมาะกับการสรุปหลายรายงานแบบไม่ลึกมาก",
      ],
      tradeoffs: [
        "คำแนะนำเชิงลึกอาจน้อยกว่ากลุ่ม Max/Pro",
        "ไม่เหมาะกับการตัดสินใจใหญ่ที่ต้องการ reasoning ละเอียด",
      ],
      recommendation:
        "ใช้เมื่อร้านเน้นต้นทุนต่ำ หรือใช้เป็น model สำหรับ shadow/dry-run จำนวนมาก",
    },
    "deepseek/deepseek-v4-flash": {
      bestFor: "lowest-cost shadow mode, dry-run และ brief สั้น",
      strengths: [
        "ต้นทุนต่ำมาก เหมาะกับการทดลอง prompt บ่อย ๆ",
        "ดีสำหรับเช็ก flow และสร้างคำแนะนำเบื้องต้น",
      ],
      tradeoffs: [
        "ไม่ควรใช้เป็นตัวหลักสำหรับร้านใหญ่ที่ต้องการ insight ลึก",
        "ควรให้ admin ตรวจคุณภาพก่อนเปิดส่งจริง",
      ],
      recommendation:
        "ใช้ช่วง onboarding หรือร้านที่ยังทดลอง AI CEO ก่อนอัปเป็น model หลัก",
    },
  };

  return (
    guides[model.model_id] ?? {
      bestFor: model.use_case,
      strengths: [
        model.intelligence_label,
        `${model.provider} model พร้อม context ${formatNumber(
          model.context_length,
        )} tokens`,
      ],
      tradeoffs: [
        "ยังไม่มี playbook เฉพาะรุ่นในระบบ ควร dry-run ก่อนเปิดส่งจริง",
        "ตรวจราคาและคุณภาพหลัง sync catalog จาก OpenRouter",
      ],
      recommendation:
        model.recommended_tier === "pro"
          ? "ใช้กับร้าน Pro หรือรอบวิเคราะห์ที่ยอมรับต้นทุนสูงได้"
          : "ใช้กับร้าน Business ได้ แต่ควรทดสอบกับข้อมูลจริงก่อน",
    }
  );
}

function modelCostLabel(model: AiCeoModelCatalogItem) {
  const blendedCost = model.price_input_per_m + model.price_output_per_m;
  if (blendedCost <= 1) {
    return "ถูกมาก";
  }
  if (blendedCost <= 4) {
    return "ประหยัด";
  }
  if (blendedCost <= 10) {
    return "สมดุล";
  }
  return "พรีเมียม";
}

function modelCostTone(model: AiCeoModelCatalogItem) {
  const blendedCost = model.price_input_per_m + model.price_output_per_m;
  if (blendedCost <= 1) {
    return "success" as const;
  }
  if (blendedCost <= 10) {
    return "info" as const;
  }
  if (blendedCost <= 25) {
    return "warning" as const;
  }
  return "error" as const;
}

function severityTone(severity: string) {
  if (severity === "critical") {
    return "error" as const;
  }
  if (severity === "warning") {
    return "warning" as const;
  }
  return "light" as const;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("th-TH").format(value);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: value >= 1 ? 2 : 4,
    minimumFractionDigits: 0,
  }).format(value);
}

function todayDateInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const date = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${date}`;
}
