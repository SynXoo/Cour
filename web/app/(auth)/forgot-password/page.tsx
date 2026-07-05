"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { browserApi } from "@/lib/api/client";

const schema = z.object({ email: z.email("Enter a valid email") });
type FormValues = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  async function onSubmit(values: FormValues) {
    await browserApi.POST("/auth/password-reset/request", { body: { email: values.email } });
    setSent(true); // always — the API never reveals whether the account exists
  }

  if (sent) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Check your inbox</h1>
        <p className="text-sm text-muted-foreground">
          If that address has an account, a reset link is on its way. The link
          expires in an hour.
        </p>
        <Button variant="outline" asChild>
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          We&apos;ll email you a link to set a new one.
        </p>
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.email || undefined}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!form.formState.errors.email}
              {...form.register("email")}
            />
            {form.formState.errors.email && (
              <FieldError>{form.formState.errors.email.message}</FieldError>
            )}
          </Field>
          <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
            {form.formState.isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
          <FieldDescription className="text-center">
            <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
              Back to sign in
            </Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  );
}
