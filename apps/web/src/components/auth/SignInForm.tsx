"use client";

import Checkbox from "@/components/form/input/Checkbox";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { rememberAdminToken } from "@/components/command-center/adminAuth";
import { ChevronLeftIcon, EyeCloseIcon, EyeIcon } from "@/icons";
import Link from "next/link";
import { FormEvent, useState } from "react";

export default function SignInForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          remember,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "เข้าสู่ระบบไม่สำเร็จ");
      }

      // During the MVP transition, the owner password is also the admin mutation token.
      // This keeps existing protected report/LINE actions from asking for a second token.
      rememberAdminToken(password);

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
              เข้าสู่ระบบผู้ดูแล
            </h1>
            <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
              ใช้บัญชีผู้ดูแลเพื่อเข้าหน้า Owner Admin, รายงานระบบ และการตั้งค่า LINE OA
            </p>
          </div>

          <div className="mb-5 rounded-2xl border border-brand-100 bg-brand-50 p-4 text-sm text-brand-800 dark:border-brand-500/20 dark:bg-brand-500/10 dark:text-brand-200">
            <p className="font-semibold">บัญชีเริ่มต้นสำหรับ pilot</p>
            <p className="mt-1 font-mono">superadmin / superadmin</p>
          </div>

          <form onSubmit={submitLogin}>
            <div className="space-y-5">
              <div>
                <Label>
                  Username <span className="text-error-500">*</span>
                </Label>
                <Input
                  autoComplete="username"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="superadmin"
                  type="text"
                />
              </div>
              <div>
                <Label>
                  Password <span className="text-error-500">*</span>
                </Label>
                <div className="relative">
                  <Input
                    autoComplete="current-password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="superadmin"
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
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Checkbox checked={remember} onChange={setRemember} />
                  <span className="block font-normal text-gray-700 text-theme-sm dark:text-gray-400">
                    จำการเข้าสู่ระบบไว้ 7 วัน
                  </span>
                </div>
              </div>

              {error && (
                <div className="rounded-xl border border-error-200 bg-error-50 p-3 text-sm text-error-700 dark:border-error-500/30 dark:bg-error-500/10 dark:text-error-300">
                  {error}
                </div>
              )}

              <Button className="w-full" disabled={loading} size="sm">
                {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
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
