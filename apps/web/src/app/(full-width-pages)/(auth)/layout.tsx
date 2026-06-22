import GridShape from "@/components/common/GridShape";
import ThemeTogglerTwo from "@/components/common/ThemeTogglerTwo";

import { ThemeProvider } from "@/context/ThemeContext";
import Image from "next/image";
import Link from "next/link";
import React from "react";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative p-6 bg-white z-1 dark:bg-gray-900 sm:p-0">
      <ThemeProvider>
        <div className="relative flex lg:flex-row w-full h-screen justify-center flex-col  dark:bg-gray-900 sm:p-0">
          {children}
          <div className="hidden h-full w-full items-center bg-brand-950 dark:bg-white/5 lg:grid lg:w-1/2">
            <div className="relative z-1 flex w-full justify-center">
              {/* <!-- ===== Common Grid Shape Start ===== --> */}
              <GridShape />
              <div className="flex w-full max-w-sm flex-col items-center px-8">
                <Link className="mb-6 block" href="/">
                  <Image
                    width={231}
                    height={48}
                    src="./images/logo/auth-logo.svg"
                    alt="Logo"
                  />
                </Link>
                <h2 className="mb-3 text-center text-title-md font-semibold text-white">
                  ศูนย์ควบคุมธุรกิจของคุณ
                </h2>
                <p className="mb-8 text-center text-sm leading-6 text-gray-400 dark:text-white/60">
                  Owner Admin สำหรับจัดการร้านค้า SML, รายงานอัตโนมัติ และ LINE OA แบบแยกข้อมูลแต่ละ tenant
                </p>
                <ul className="w-full space-y-4">
                  <HighlightItem
                    description="ดึงรายงานจาก SML JavaWS และสรุปเป็น brief ที่อ่านได้ทันที"
                    title="รายงานอัตโนมัติ"
                  />
                  <HighlightItem
                    description="ส่ง brief ผ่าน LINE OA ตามเวลาที่กำหนด แยก role ผู้บริหาร/ผู้จัดการ"
                    title="แจ้งเตือน LINE"
                  />
                  <HighlightItem
                    description="ตรวจสัญญาณธุรกิจและ incident ข้ามร้าน พร้อมหลักฐาน 7 วัน"
                    title="ติดตามสถานะร้าน"
                  />
                </ul>
              </div>
            </div>
          </div>
          <div className="fixed bottom-6 right-6 z-50 hidden sm:block">
            <ThemeTogglerTwo />
          </div>
        </div>
      </ThemeProvider>
    </div>
  );
}

function HighlightItem({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-400">
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          viewBox="0 0 24 24"
        >
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-0.5 text-xs leading-5 text-gray-400 dark:text-white/60">
          {description}
        </p>
      </div>
    </li>
  );
}
