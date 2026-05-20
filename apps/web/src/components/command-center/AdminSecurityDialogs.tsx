"use client";

import { FormEvent, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import {
  type AdminConfirmationRequest,
  type AdminTokenRequest,
  resolveAdminConfirmationRequest,
  resolveAdminTokenRequest,
  subscribeAdminConfirmationRequests,
  subscribeAdminTokenRequests,
} from "./adminAuth";

export function AdminSecurityDialogs() {
  return (
    <>
      <AdminTokenDialog />
      <AdminConfirmationDialog />
    </>
  );
}

function AdminTokenDialog() {
  const [request, setRequest] = useState<AdminTokenRequest | null>(null);
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(true);
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeAdminTokenRequests(setRequest), []);

  useEffect(() => {
    if (request) {
      setToken("");
      setRemember(true);
      setShowToken(false);
      setError(null);
    }
  }, [request]);

  function closeDialog() {
    if (request) {
      resolveAdminTokenRequest(request.id, null);
    }
  }

  function submitToken(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedToken = token.trim();

    if (!trimmedToken) {
      setError("กรุณากรอก Admin token ก่อนทำรายการ");
      return;
    }

    if (request) {
      resolveAdminTokenRequest(request.id, trimmedToken, remember);
    }
  }

  return (
    <Modal
      isOpen={Boolean(request)}
      onClose={closeDialog}
      className="m-4 max-w-[520px]"
    >
      <form className="p-5 sm:p-6" onSubmit={submitToken}>
        <div className="pr-12">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-500">
            Admin verification
          </p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">
            ยืนยันสิทธิ์ผู้ดูแล
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
            รายการนี้จะเปลี่ยนข้อมูลจริง เช่น รันรายงาน ส่ง LINE หรือแก้สิทธิ์กลุ่ม
            กรุณากรอก Admin token ที่ได้จากผู้ดูแลระบบ
          </p>
        </div>

        <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-white/[0.03]">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            รายการที่กำลังทำ
          </p>
          <p className="mt-1 text-sm font-semibold text-gray-800 dark:text-white/90">
            {request?.options.actionLabel ?? "ทำรายการที่เปลี่ยนข้อมูล"}
          </p>
          {request?.options.description && (
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {request.options.description}
            </p>
          )}
        </div>

        <div className="mt-5">
          <label
            className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-400"
            htmlFor="ai-bcc-admin-token"
          >
            Admin token
          </label>
          <div className="flex gap-2">
            <input
              id="ai-bcc-admin-token"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30 dark:focus:border-brand-800"
              onChange={(event) => setToken(event.target.value)}
              placeholder="กรอก token จากผู้ดูแลระบบ"
              type={showToken ? "text" : "password"}
              value={token}
            />
            <button
              className="h-11 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              onClick={() => setShowToken((value) => !value)}
              type="button"
            >
              {showToken ? "ซ่อน" : "แสดง"}
            </button>
          </div>
          {error && <p className="mt-2 text-xs text-error-500">{error}</p>}
        </div>

        <label className="mt-4 flex items-start gap-3 text-sm text-gray-600 dark:text-gray-400">
          <input
            checked={remember}
            className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            onChange={(event) => setRemember(event.target.checked)}
            type="checkbox"
          />
          <span>
            จำ token ไว้ใน browser นี้ชั่วคราวจนกว่าจะปิดแท็บหรือ token ใช้ไม่ได้
          </span>
        </label>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03]"
            onClick={closeDialog}
            type="button"
          >
            ยกเลิก
          </button>
          <button
            className="inline-flex items-center justify-center rounded-lg bg-brand-500 px-5 py-3 text-sm font-medium text-white shadow-theme-xs hover:bg-brand-600"
            type="submit"
          >
            ยืนยันสิทธิ์
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AdminConfirmationDialog() {
  const [request, setRequest] = useState<AdminConfirmationRequest | null>(null);

  useEffect(() => subscribeAdminConfirmationRequests(setRequest), []);

  function closeDialog() {
    if (request) {
      resolveAdminConfirmationRequest(request.id, false);
    }
  }

  function confirmAction() {
    if (request) {
      resolveAdminConfirmationRequest(request.id, true);
    }
  }

  const isDanger = request?.options.tone === "danger";

  return (
    <Modal
      isOpen={Boolean(request)}
      onClose={closeDialog}
      className="m-4 max-w-[560px]"
    >
      <div className="p-5 sm:p-6">
        <div className="pr-12">
          <p
            className={`text-xs font-semibold uppercase tracking-wide ${
              isDanger ? "text-warning-600" : "text-brand-500"
            }`}
          >
            Confirm action
          </p>
          <h2 className="mt-2 text-xl font-semibold text-gray-900 dark:text-white">
            {request?.options.title ?? "ยืนยันการทำรายการ"}
          </h2>
          <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-400">
            {request?.options.message}
          </p>
        </div>

        {request?.options.details?.length ? (
          <div className="mt-5 divide-y divide-gray-100 rounded-xl border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
            {request.options.details.map((item) => (
              <div
                className="grid grid-cols-[140px_1fr] gap-3 px-4 py-3 text-sm"
                key={item.label}
              >
                <span className="text-gray-500 dark:text-gray-400">
                  {item.label}
                </span>
                <span className="font-medium text-gray-800 dark:text-white/90">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03]"
            onClick={closeDialog}
            type="button"
          >
            {request?.options.cancelLabel ?? "ยกเลิก"}
          </button>
          <button
            className={`inline-flex items-center justify-center rounded-lg px-5 py-3 text-sm font-medium text-white shadow-theme-xs ${
              isDanger
                ? "bg-warning-500 hover:bg-warning-600"
                : "bg-brand-500 hover:bg-brand-600"
            }`}
            onClick={confirmAction}
            type="button"
          >
            {request?.options.confirmLabel ?? "ยืนยัน"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
