import type { Metadata } from "next";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = { title: "Join" };

export default function RegisterPage() {
  return <RegisterForm />;
}
