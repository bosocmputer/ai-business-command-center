"use client";

import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { ChevronLeftIcon, EyeCloseIcon, EyeIcon } from "@/icons";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function SignInForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [setupMode, setSetupMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(
        setupMode ? "/auth/bootstrap-admin" : "/auth/login",
        {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          display_name: displayName,
          remember,
        }),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 428) {
          setSetupMode(true);
        }
        throw new Error(payload.error || "เข้าสู่ระบบไม่สำเร็จ");
      }

      const params = new URLSearchParams(window.location.search);
      const nextPath = normalizeNextPath(params.get("next"));
      window.location.assign(nextPath);
    } catch (unknownError) {
      setError(
        unknownError instanceof Error
          ? unknownError.message
          : "เข้าสู่ระบบไม่สำเร็จ",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-1 flex-col lg:w-1/2">
      <div className="mx-auto mb-5 w-full max-w-md sm:pt-10">
        <Link
          href="/app"
          className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeftIcon />
          กลับไปหน้า Customer Viewer
        </Link>
      </div>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
        <div>
          <div className="mb-5 sm:mb-8">
            <p className="mb-2 text-sm font-medium text-brand-500">
              AI Business Owner
            </p>
            <h1 className="mb-2 font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
              {setupMode ? "สร้างบัญชีผู้ดูแลคนแรก" : "เข้าสู่ระบบผู้ดูแล"}
            </h1>
            <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
              {setupMode
                ? "ระบบยังไม่มี owner admin ใน DB กรุณาสร้างบัญชีแรกเพื่อเลิกพึ่ง username/password ใน env"
                : "ใช้บัญชีผู้ดูแลเพื่อเข้าหน้า Owner Admin, รายงานระบบ และการตั้งค่า LINE OA"}
            </p>
          </div>

          <div className="mb-5 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-gray-300">
            <p className="font-semibold text-gray-800 dark:text-white/90">
              สำหรับผู้ดูแลระบบเท่านั้น
            </p>
            <p className="mt-1 leading-6">
              กรอกบัญชีผู้ดูแลที่ได้รับจากเจ้าของระบบเพื่อจัดการร้านค้า รายงาน และ LINE OA
            </p>
          </div>

          <form onSubmit={submitLogin}>
            <div className="space-y-5">
              {setupMode ? (
                <div>
                  <Label htmlFor="owner-display-name">ชื่อที่แสดง</Label>
                  <Input
                    autoComplete="name"
                    id="owner-display-name"
                    name="display_name"
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder="เช่น Boss Admin"
                    type="text"
                  />
                </div>
              ) : null}
              <div>
                <Label htmlFor="owner-username">
                  Username <span className="text-error-500">*</span>
                </Label>
                <Input
                  autoComplete="username"
                  id="owner-username"
                  name="username"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="กรอกชื่อผู้ใช้"
                  type="text"
                />
              </div>
              <div>
                <Label htmlFor="owner-password">
                  Password <span className="text-error-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    autoComplete="current-password"
                    id="owner-password"
                    name="password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="กรอกรหัสผ่าน"
                    type={showPassword ? "text" : "password"}
                  />
                  <button
                    aria-label={showPassword ? "ซ่อน password" : "แสดง password"}
                    className="absolute top-1/2 right-4 z-30 -translate-y-1/2 cursor-pointer"
                    onClick={() => setShowPassword((value) => !value)}
                    type="button"
                  >
                    {showPassword ? (
                      <EyeIcon className="fill-gray-500 dark:fill-gray-400" />
                    ) : (
                      <EyeCloseIcon className="fill-gray-500 dark:fill-gray-400" />
                    )}
                  </button>
                </div>
                {setupMode ? (
                  <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                    รหัสผ่านบัญชีแรกต้องยาวอย่างน้อย 12 ตัวอักษร และจะถูกเก็บเป็น encrypted password hash ใน System DB
                  </p>
                ) : null}
              </div>

              {!setupMode ? (
                <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Checkbox checked={remember} onChange={setRemember} />
                  <span className="block font-normal text-gray-700 text-theme-sm dark:text-gray-400">
                    จำการเข้าสู่ระบบไว้ 7 วัน
                  </span>
                </div>
                </div>
              ) : null}

              {error && (
                <div className="rounded-xl border border-error-200 bg-error-50 p-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
                  {error}
                </div>
              )}

              <Button className="w-full" disabled={loading} size="sm">
                {loading
                  ? setupMode
                    ? "กำลังสร้างบัญชี..."
                    : "กำลังเข้าสู่ระบบ..."
                  : setupMode
                    ? "สร้างบัญชีและเข้าสู่ระบบ"
                    : "เข้าสู่ระบบ"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function normalizeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/owner";
  }

  if (value.startsWith("/signin") || value.startsWith("/auth/")) {
    return "/owner";
  }

  return value;
}
