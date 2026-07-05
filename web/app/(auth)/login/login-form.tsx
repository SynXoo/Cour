"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthError, useSession } from "@/lib/auth/session";

const schema = z.object({
  email: z.email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

type FormValues = z.infer<typeof schema>;

const OAUTH_ERRORS: Record<string, string> = {
  discord_no_email: "Your Discord account has no verified email — add one on Discord first.",
  discord_state: "The Discord sign-in expired. Try again.",
  discord_cancelled: "Discord sign-in was cancelled.",
  discord_failed: "Discord sign-in failed. Try again or use email.",
};

export function LoginForm() {
  const { login } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [submitting, setSubmitting] = useState(false);

  const oauthError = params.get("error");

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const user = await login(values.email, values.password);
      toast.success(`Welcome back, ${user.username}`);
      router.push("/");
      router.refresh();
    } catch (err) {
      const message =
        err instanceof AuthError ? err.message : "Something went wrong — try again.";
      form.setError("root", { message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Pick up right where this season left off.
        </p>
      </div>

      {oauthError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {OAUTH_ERRORS[oauthError] ?? "Sign-in failed. Try again."}
        </p>
      )}

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

          <Field data-invalid={!!form.formState.errors.password || undefined}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
              >
                Forgot it?
              </Link>
            </div>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              aria-invalid={!!form.formState.errors.password}
              {...form.register("password")}
            />
            {form.formState.errors.password && (
              <FieldError>{form.formState.errors.password.message}</FieldError>
            )}
          </Field>

          {form.formState.errors.root && (
            <FieldError>{form.formState.errors.root.message}</FieldError>
          )}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>

          <FieldSeparator>or</FieldSeparator>

          <Button variant="outline" className="w-full" asChild>
            <a href="/api/v1/auth/discord">Continue with Discord</a>
          </Button>

          <FieldDescription className="text-center">
            New here?{" "}
            <Link href="/register" className="underline underline-offset-4 hover:text-foreground">
              Create an account
            </Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  );
}
