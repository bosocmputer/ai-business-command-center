"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import {
  type AdminConfirmationRequest,
  resolveAdminConfirmationRequest,
  subscribeAdminConfirmationRequests,
} from "./adminAuth";

export function AdminSecurityDialogs() {
  return (
    <>
      <AdminConfirmationDialog />
    </>
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
