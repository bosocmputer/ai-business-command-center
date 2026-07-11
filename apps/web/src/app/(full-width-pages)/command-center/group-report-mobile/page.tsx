import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "เปิดจาก LINE บนโทรศัพท์ | AI Business Center",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function GroupReportMobilePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-5 py-10 dark:bg-gray-950">
      <section className="w-full max-w-lg border border-gray-200 bg-white p-6 text-center shadow-theme-sm dark:border-gray-800 dark:bg-gray-900 sm:p-8">
        <p className="text-sm font-semibold text-brand-600 dark:text-brand-400">
          AI Business Center
        </p>
        <h1 className="mt-3 text-2xl font-semibold text-gray-900 dark:text-white">
          กรุณาเปิดจาก LINE บนโทรศัพท์
        </h1>
        <p className="mt-4 text-sm leading-6 text-gray-600 dark:text-gray-300">
          กลับไปที่การ์ดรายงานในกลุ่ม LINE แล้วกดปุ่ม
          &ldquo;รับลิงก์ส่วนตัว&rdquo; จากโทรศัพท์
        </p>
      </section>
    </main>
  );
}
