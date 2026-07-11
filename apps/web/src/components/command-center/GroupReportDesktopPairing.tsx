"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { getCommandCenterApiBaseUrl } from "./apiBaseUrl";

const API_BASE_URL = getCommandCenterApiBaseUrl();
const POLL_INTERVAL_MS = 2_000;
const CODE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

type PairingState =
  | { status: "loading" }
  | {
      status: "pending";
      pairingId: string;
      chatUri: string;
      qrDataUrl: string;
      expiresAt: string;
      launchCode: string;
    }
  | { status: "redirecting" }
  | { status: "expired"; launchCode: string }
  | { status: "error"; message: string; launchCode: string | null };

type CreatePairingResponse = {
  data?: {
    pairing_id: string;
    expires_at: string;
    chat_uri: string;
  };
  code?: string;
  error?: string;
};

type PairingStatusResponse = {
  data?: {
    status: "pending" | "approved" | "expired" | "revoked";
    expires_at?: string;
    viewer_path?: string;
  };
  error?: string;
};

export default function GroupReportDesktopPairing() {
  const [state, setState] = useState<PairingState>({ status: "loading" });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const requestIdRef = useRef(0);

  const createPairing = useCallback(async (launchCode: string) => {
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    try {
      let payload: CreatePairingResponse = {};
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const response = await fetch(`${API_BASE_URL}/api/report-group-pairings`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ launch_code: launchCode }),
          credentials: "include",
          cache: "no-store",
        });
        payload = (await response.json().catch(() => ({}))) as CreatePairingResponse;
        if (
          response.status === 428 &&
          payload.code === "VIEWER_SESSION_BOOTSTRAP_REQUIRED" &&
          attempt === 0
        ) {
          continue;
        }
        if (!response.ok || !payload.data) {
          throw new Error(
            payload.error ?? "สร้างคำขอเปิดรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
          );
        }
        break;
      }
      if (!payload.data) {
        throw new Error("สร้างคำขอเปิดรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
      }
      const qrDataUrl = await QRCode.toDataURL(payload.data.chat_uri, {
        width: 464,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#101828", light: "#FFFFFF" },
      });
      if (requestId !== requestIdRef.current) return;
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
      setState({
        status: "pending",
        pairingId: payload.data.pairing_id,
        chatUri: payload.data.chat_uri,
        qrDataUrl,
        expiresAt: payload.data.expires_at,
        launchCode,
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "สร้างคำขอเปิดรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        launchCode,
      });
    }
  }, []);

  useEffect(() => {
    const launchCode = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    ).get("launch");
    if (!launchCode || !CODE_PATTERN.test(launchCode)) {
      setState({
        status: "error",
        message: "คำขอหมดอายุ กรุณากดจากรายงานล่าสุดในกลุ่ม LINE",
        launchCode: null,
      });
      return;
    }
    void createPairing(launchCode);
  }, [createPairing]);

  useEffect(() => {
    if (state.status !== "pending") return;
    const updateCountdown = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(state.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0) {
        setState({ status: "expired", launchCode: state.launchCode });
      }
    };
    updateCountdown();
    const interval = window.setInterval(updateCountdown, 1_000);
    return () => window.clearInterval(interval);
  }, [state]);

  useEffect(() => {
    if (state.status !== "pending") return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/report-group-pairings/${encodeURIComponent(
            state.pairingId,
          )}`,
          { credentials: "include", cache: "no-store" },
        );
        const payload = (await response.json().catch(() => ({}))) as PairingStatusResponse;
        if (stopped) return;
        if (!response.ok || !payload.data) {
          if (response.status === 403 || response.status === 404) {
            setState({
              status: "error",
              message: payload.error ?? "ไม่พบสิทธิ์เปิดรายงานในอุปกรณ์นี้",
              launchCode: state.launchCode,
            });
          }
          return;
        }
        if (payload.data.status === "approved" && payload.data.viewer_path) {
          setState({ status: "redirecting" });
          window.location.replace(payload.data.viewer_path);
          return;
        }
        if (
          payload.data.status === "expired" ||
          payload.data.status === "revoked"
        ) {
          setState({ status: "expired", launchCode: state.launchCode });
        }
      } catch {
        // A later poll retries transient network failures without creating a new pairing.
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [state]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-5 py-10 dark:bg-gray-950">
      <section className="w-full max-w-xl border border-gray-200 bg-white px-6 py-8 text-center shadow-theme-sm dark:border-gray-800 dark:bg-gray-900 sm:px-10 sm:py-10">
        <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">
          AI Business Center
        </p>
        {state.status === "loading" ? (
          <PairingMessage
            title="กำลังเตรียมการเปิดรายงาน"
            message="กรุณารอสักครู่"
            loading
          />
        ) : null}
        {state.status === "pending" ? (
          <>
            <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
              ยืนยันสิทธิ์ด้วย LINE
            </h1>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-600 dark:text-gray-300">
              สแกน QR ด้วยโทรศัพท์ที่เป็นสมาชิกกลุ่ม แล้วกดส่งข้อความใน LINE
            </p>
            <div className="mx-auto mt-6 size-[248px] border border-gray-200 bg-white p-2 dark:border-gray-700">
              <Image
                src={state.qrDataUrl}
                alt="QR สำหรับยืนยันสิทธิ์เปิดรายงาน"
                width={232}
                height={232}
                unoptimized
                priority
              />
            </div>
            <a
              href={state.chatUri}
              className="mt-5 inline-flex min-h-11 items-center justify-center bg-brand-500 px-5 py-3 text-sm font-medium text-white hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            >
              เปิด LINE บนเครื่องนี้
            </a>
            <p className="mt-5 text-sm font-medium text-gray-700 dark:text-gray-200" aria-live="polite">
              รอการยืนยัน · เหลือ {formatCountdown(secondsLeft)}
            </p>
          </>
        ) : null}
        {state.status === "redirecting" ? (
          <PairingMessage
            title="ยืนยันสำเร็จ"
            message="กำลังเปิดรายงาน"
            loading
          />
        ) : null}
        {state.status === "expired" ? (
          <PairingMessage
            title="คำขอนี้หมดอายุแล้ว"
            message="กดสร้าง QR ใหม่ หรือกลับไปกดจากรายงานล่าสุดในกลุ่ม LINE"
            actionLabel="สร้าง QR ใหม่"
            onAction={() => void createPairing(state.launchCode)}
          />
        ) : null}
        {state.status === "error" ? (
          <PairingMessage
            title="เปิดรายงานไม่ได้"
            message={state.message}
            actionLabel={state.launchCode ? "ลองอีกครั้ง" : undefined}
            onAction={
              state.launchCode
                ? () => void createPairing(state.launchCode!)
                : undefined
            }
          />
        ) : null}
      </section>
    </main>
  );
}

function PairingMessage(input: {
  title: string;
  message: string;
  loading?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="py-8">
      {input.loading ? (
        <div className="mx-auto mb-5 size-8 animate-spin rounded-full border-2 border-gray-200 border-t-brand-500" />
      ) : null}
      <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
        {input.title}
      </h1>
      <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
        {input.message}
      </p>
      {input.actionLabel && input.onAction ? (
        <button
          type="button"
          onClick={input.onAction}
          className="mt-6 min-h-11 bg-brand-500 px-5 py-3 text-sm font-medium text-white hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
        >
          {input.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")} นาที`;
}
