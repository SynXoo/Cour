"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  username: z
    .string()
    .regex(/^[a-zA-Z0-9_]{3,20}$/, "3-20 characters: letters, digits, underscore"),
  password: z.string().min(8, "At least 8 characters").max(128, "At most 128 characters"),
});

type FormValues = z.infer<typeof schema>;

export function RegisterForm() {
  const { register: signUp } = useSession();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", username: "", password: "" },
  });

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    try {
      const user = await signUp(values.email, values.username, values.password);
      toast.success(`Welcome to Cour, ${user.username}! Check your email to verify your address.`);
      router.push("/");
      router.refresh();
    } catch (err) {
      if (err instanceof AuthError) {
        if (err.code === "conflict" && err.message.includes("email")) {
          form.setError("email", { message: err.message });
        } else if (err.code === "conflict") {
          form.setError("username", { message: err.message });
        } else if (err.code === "validation_failed" && err.details) {
          for (const [field, message] of Object.entries(err.details as Record<string, string>)) {
            form.setError(field as keyof FormValues, { message });
          }
        } else {
          form.setError("root", { message: err.message });
        }
      } else {
        form.setError("root", { message: "Something went wrong — try again." });
      }
    } finally {
      setSubmitting(false);
    }
  }

  const errors = form.formState.errors;

  return (
    <div className="space-y-6">
      <div className="space-y-1 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Join Cour</h1>
        <p className="text-sm text-muted-foreground">
          Track the season, join the episode threads.
        </p>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={!!errors.email || undefined}>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...form.register("email")}
            />
            {errors.email && <FieldError>{errors.email.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.username || undefined}>
            <FieldLabel htmlFor="username">Username</FieldLabel>
            <Input
              id="username"
              autoComplete="username"
              aria-invalid={!!errors.username}
              {...form.register("username")}
            />
            <FieldDescription>Your public handle — profile lives at /users/you</FieldDescription>
            {errors.username && <FieldError>{errors.username.message}</FieldError>}
          </Field>

          <Field data-invalid={!!errors.password || undefined}>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              {...form.register("password")}
            />
            {errors.password && <FieldError>{errors.password.message}</FieldError>}
          </Field>

          {errors.root && <FieldError>{errors.root.message}</FieldError>}

          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? "Creating account…" : "Create account"}
          </Button>

          <FieldSeparator>or</FieldSeparator>

          <Button variant="outline" className="w-full" asChild>
            <a href="/api/v1/auth/discord">Continue with Discord</a>
          </Button>

          <FieldDescription className="text-center">
            Already have an account?{" "}
            <Link href="/login" className="underline underline-offset-4 hover:text-foreground">
              Sign in
            </Link>
          </FieldDescription>
        </FieldGroup>
      </form>
    </div>
  );
}
