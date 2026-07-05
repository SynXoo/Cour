"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { browserApi } from "@/lib/api/client";

const schema = z.object({
  password: z.string().min(8, "At least 8 characters").max(128, "At most 128 characters"),
});
type FormValues = z.infer<typeof schema>;

export function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { password: "" } });

  if (!token) {
    return (
      <div className="space-y-3 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Missing token</h1>
        <p className="text-sm text-muted-foreground">
          Use the link from your reset email.
        </p>
        <Button variant="outline" asChild>
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  async function onSubmit(values: FormValues) {
    const res = await browserApi.POST("/auth/password-reset/confirm", {
      body: { token, password: values.password },
    });
    if (res.error) {
      form.setError("root", {
        message:
          res.error.error.code === "bad_request"
            ? "That link is invalid or expired — request a new one."
            : res.error.error.message,
      });
      return;
    }
    toast.success("Password updated — sign in with the new one.");
    router.push("/login");
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Set a new password</h1>
        <p className="text-sm text-muted-foreground">
          This signs you out everywhere else.
        </p>
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={!!form.formState.errors.password || undefined}>
            <FieldLabel htmlFor="password">New password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
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
          <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
            {form.formState.isSubmitting ? "Saving…" : "Save password"}
          </Button>
        </FieldGroup>
      </form>
    </div>
  );
}
