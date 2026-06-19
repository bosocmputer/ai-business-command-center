"use client";

import { useEffect } from "react";
import Button from "@/components/ui/button/Button";

/**
 * Root route error boundary. Catches uncaught errors during render so the user
 * never sees a blank white page — they get a short Thai explanation and a way
 * to retry or go back to the owner cockpit.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log to console for ops; server-side logging is handled by Next.js.
    // eslint-disable-next-line no-console
    console.error("owner-v2 render error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <div className="rounded-2xl border border-error-500/30 bg-error-50 p-8 dark:bg-error-500/10">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          เกิดข้อผิดพลาดในการแสดงหน้านี้
        </h2>
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
          ลองโหลดหน้าใหม่อีกครั้ง ถ้ายังพบปัญหาให้กลับไปหน้าเริ่มงานแล้วแจ้งทีมดูแล
        </p>
        {error.digest ? (
          <p className="mt-3 break-all font-mono text-xs text-gray-400">
            {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={reset} type="button">
            ลองใหม่
          </Button>
          <a
            className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-theme-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 sm:w-auto"
            href="/owner-v2"
          >
            กลับหน้าเริ่มงาน
          </a>
        </div>
      </div>
    </div>
  );
}
