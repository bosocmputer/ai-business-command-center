import SignInForm from "@/components/auth/SignInForm";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "เข้าสู่ระบบผู้ดูแล | AI Business",
  description: "Owner Admin login สำหรับ AI Business SaaS Pilot",
};

export default function SignIn() {
  return <SignInForm />;
}
