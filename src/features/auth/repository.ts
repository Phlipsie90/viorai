import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient, getSupabaseUserSafe } from "@/lib/supabase/client";
import { setDevTenantOverride, tryResolveTenantContext } from "@/lib/supabase/tenant-context";

export interface RegistrationPayload {
  companyName: string;
  contactPerson?: string;
  email: string;
  phone?: string;
  address?: string;
  password: string;
}

export interface TenantSetupPayload {
  companyName: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export function getAuthClient(): SupabaseClient {
  return getSupabaseClient();
}

export async function signIn(email: string, password: string): Promise<void> {
  const supabase = getAuthClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function signOut(): Promise<void> {
  const supabase = getAuthClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new Error(error.message);
  }

  setDevTenantOverride(null);
}

function normalizeOptional(value?: string): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function ensureTenantMembership(tenantId: string): Promise<boolean> {
  try {
    const supabase = getAuthClient();
    const { data, error } = await withTimeout<{ data: string | null; error: { message: string } | null }>(
      Promise.resolve(
        supabase.rpc("ensure_tenant_membership_for_current_user", {
          target_tenant_id: tenantId,
        })
      ),
      10000,
      "Tenant-Membership-Setup-Timeout."
    );

    return !error && typeof data === "string" && data === tenantId;
  } catch {
    return false;
  }
}

export async function ensureTenantInitialization(payload: TenantSetupPayload): Promise<string> {
  const companyName = payload.companyName.trim();
  if (companyName.length === 0) {
    throw new Error("Firmenname ist erforderlich.");
  }

  const supabase = getAuthClient();
  const { data, error } = await withTimeout<{
    data: string | null;
    error: { message: string } | null;
  }>(
    Promise.resolve(
      supabase.rpc("initialize_tenant_for_current_user", {
        p_company_name: companyName,
        p_contact_person: normalizeOptional(payload.contactPerson),
        p_email: normalizeOptional(payload.email),
        p_phone: normalizeOptional(payload.phone),
        p_address: normalizeOptional(payload.address),
      })
    ),
    15000,
    "Setup-Timeout. Bitte erneut versuchen."
  );

  if (error) {
    if (error.message.includes("initialize_tenant_for_current_user")) {
      throw new Error("Tenant-Setup-Funktion fehlt in der Datenbank. Bitte Migration ausführen.");
    }
    throw new Error(error.message);
  }

  if (!data || typeof data !== "string") {
    throw new Error("Tenant konnte nicht initialisiert werden.");
  }

  setDevTenantOverride(data);
  await ensureTenantMembership(data);
  return data;
}

export async function signUpAndInitialize(payload: RegistrationPayload): Promise<string> {
  const supabase = getAuthClient();
  const normalizedEmail = payload.email.trim();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: payload.password,
    options: {
      data: {
        company_name: payload.companyName.trim(),
        contact_person: payload.contactPerson?.trim() || null,
        phone: payload.phone?.trim() || null,
        address: payload.address?.trim() || null,
      },
    },
  });

  if (signUpError) {
    throw new Error(signUpError.message);
  }

  let session = signUpData.session;

  if (!session) {
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: payload.password,
    });

    if (signInError || !signInData.session) {
      throw new Error(signInError?.message ?? "Registrierung erfolgreich. Bitte E-Mail bestätigen und anmelden.");
    }

    session = signInData.session;
  }

  if (!session) {
    throw new Error("Registrierung erfolgreich, aber keine Session verfügbar.");
  }

  return ensureTenantInitialization({
    companyName: payload.companyName,
    contactPerson: payload.contactPerson,
    email: normalizedEmail,
    phone: payload.phone,
    address: payload.address,
  });
}

export async function hasTenantContext(): Promise<boolean> {
  try {
    const supabase = getAuthClient();
    const tenant = await withTimeout(
      tryResolveTenantContext(supabase),
      10000,
      "Tenant-Kontext-Timeout."
    );
    return !!tenant;
  } catch {
    return false;
  }
}

export async function hasTenantMembership(tenantId: string): Promise<boolean> {
  try {
    const supabase = getAuthClient();
    const {
      data: { user },
    } = await withTimeout(getSupabaseUserSafe(supabase), 10000, "Benutzer-Kontext-Timeout.");

    if (!user?.id || !tenantId) {
      return false;
    }

    const { data, error } = await withTimeout(
      Promise.resolve(
        supabase
          .from("tenant_users")
          .select("tenant_id")
          .eq("auth_user_id", user.id)
          .eq("is_active", true)
          .eq("tenant_id", tenantId)
          .limit(1)
          .maybeSingle()
      ),
      10000,
      "Tenant-Membership-Timeout."
    );

    return !error && !!data;
  } catch {
    return false;
  }
}
