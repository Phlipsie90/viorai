import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseUserSafe } from "@/lib/supabase/client";

interface TenantMembershipRow {
  tenant_id: string;
}

interface TenantRow {
  id: string;
}

interface TenantResolverRow {
  tenant_id: string;
}

const DEV_TENANT_OVERRIDE_KEY = "crm-tool.dev-tenant-id";

export interface TenantContext {
  tenantId: string;
  userId?: string;
  source: "auth" | "database";
}

export async function resolveTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const context = await tryResolveTenantContext(supabase);
  if (context) {
    return context;
  }

  throw new Error("Kein Tenant-Kontext verfügbar. Bitte einen Tenant anlegen oder auswählen.");
}

export async function tryResolveTenantContext(supabase: SupabaseClient): Promise<TenantContext | null> {
  try {
    const hostname = getBrowserHostname();
    const subdomainSlug = getSubdomainSlug(hostname);
    const isLocalDevelopmentHost = isLocalDevelopmentHostname(hostname);
    const devTenantOverride = getDevTenantOverride();

    const {
      data: { user },
    } = await withTimeout(getSupabaseUserSafe(supabase), 10000);

    if (user?.id) {
      const { data: membership, error: membershipError } = await withTimeout<{
        data: TenantMembershipRow | null;
        error: { message: string } | null;
      }>(
        Promise.resolve(
          supabase
            .from("tenant_users")
            .select("tenant_id")
            .eq("auth_user_id", user.id)
            .eq("is_active", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle()
        ),
        10000
      );

      if (!membershipError && membership) {
        const row = membership as TenantMembershipRow;
        return {
          tenantId: row.tenant_id,
          userId: user.id,
          source: "auth",
        };
      }
    }

    if (isLocalDevelopmentHost && user?.id) {
      const localResolver = await resolveTenantForLocalDevelopment(supabase);
      if (localResolver) {
        return {
          tenantId: localResolver.tenant_id,
          userId: user.id,
          source: "database",
        };
      }
    }

    if (isLocalDevelopmentHost && devTenantOverride && user?.id) {
      const scopedMembership = await findMembershipByTenantId(supabase, user.id, devTenantOverride);
      if (scopedMembership) {
        return {
          tenantId: scopedMembership.tenant_id,
          userId: user.id,
          source: "auth",
        };
      }

      const ensuredTenantId = await ensureTenantMembershipForCurrentUser(supabase, devTenantOverride);
      if (ensuredTenantId) {
        return {
          tenantId: ensuredTenantId,
          userId: user.id,
          source: "database",
        };
      }

      return {
        tenantId: devTenantOverride,
        userId: user.id,
        source: "database",
      };
    }

    if (isLocalDevelopmentHost) {
      const localDevTenant = await findTenantBySlug(supabase, "local-dev");
      if (localDevTenant) {
        return {
          tenantId: localDevTenant.id,
          source: "database",
        };
      }
    } else if (subdomainSlug) {
      const subdomainTenant = await findTenantBySlug(supabase, subdomainSlug);
      if (subdomainTenant) {
        return {
          tenantId: subdomainTenant.id,
          source: "database",
        };
      }
    }

    const { data: firstTenant, error: tenantError } = await withTimeout<{
      data: TenantRow | null;
      error: { message: string } | null;
    }>(
      Promise.resolve(
        supabase
          .from("tenants")
          .select("id")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
      ),
      10000
    );

    if (!tenantError && firstTenant) {
      const row = firstTenant as TenantRow;
      return {
        tenantId: row.id,
        source: "database",
      };
    }
  } catch {
    return null;
  }

  return null;
}

async function findTenantBySlug(supabase: SupabaseClient, slug: string): Promise<TenantRow | null> {
  const { data, error } = await withTimeout<{
    data: TenantRow | null;
    error: { message: string } | null;
  }>(
    Promise.resolve(
      supabase
        .from("tenants")
        .select("id")
        .ilike("slug", slug)
        .limit(1)
        .maybeSingle()
    ),
    10000
  );

  if (error || !data) {
    return null;
  }

  return data as TenantRow;
}

async function findMembershipByTenantId(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string
): Promise<TenantMembershipRow | null> {
  const { data, error } = await withTimeout<{
    data: TenantMembershipRow | null;
    error: { message: string } | null;
  }>(
    Promise.resolve(
        supabase
        .from("tenant_users")
        .select("tenant_id")
          .eq("auth_user_id", userId)
          .eq("is_active", true)
        .eq("tenant_id", tenantId)
        .limit(1)
        .maybeSingle()
    ),
    10000
  );

  if (error || !data) {
    return null;
  }

  return data as TenantMembershipRow;
}

function getBrowserHostname(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.location.hostname.toLowerCase();
}

function isLocalDevelopmentHostname(hostname: string): boolean {
  if (!hostname) {
    return true;
  }

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "0.0.0.0") {
    return true;
  }

  if (isPrivateIpv4(hostname)) {
    return true;
  }

  if (!isDevelopmentRuntime()) {
    return false;
  }

  if (hostname === "host.docker.internal") {
    return true;
  }

  if (hostname.endsWith(".local") || hostname.endsWith(".lan")) {
    return true;
  }

  if (!hostname.includes(".")) {
    return true;
  }

  return false;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first, second] = octets;
  if (first === 10) {
    return true;
  }

  if (first === 192 && second === 168) {
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  return false;
}

function isDevelopmentRuntime(): boolean {
  return process.env.NODE_ENV !== "production";
}

function getSubdomainSlug(hostname: string): string | null {
  if (!hostname || isLocalDevelopmentHostname(hostname)) {
    return null;
  }

  const parts = hostname.split(".").filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const [subdomain] = parts;
  if (!subdomain) {
    return null;
  }

  return subdomain.toLowerCase();
}

async function resolveTenantForLocalDevelopment(supabase: SupabaseClient): Promise<TenantResolverRow | null> {
  const { data, error } = await withTimeout(
    Promise.resolve(supabase.rpc("resolve_localhost_tenant_context")),
    10000
  );

  if (error || !data) {
    return null;
  }

  const tenantId = typeof data === "string" ? data : null;
  if (!tenantId) {
    return null;
  }

  return {
    tenant_id: tenantId,
  };
}

async function ensureTenantMembershipForCurrentUser(
  supabase: SupabaseClient,
  tenantId: string
): Promise<string | null> {
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase.rpc("ensure_tenant_membership_for_current_user", {
        target_tenant_id: tenantId,
      })
    ),
    10000
  );

  if (error || typeof data !== "string" || !data) {
    return null;
  }

  return data;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("tenant_context_timeout")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function setDevTenantOverride(tenantId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }

  if (!tenantId) {
    window.sessionStorage.removeItem(DEV_TENANT_OVERRIDE_KEY);
    return;
  }

  window.sessionStorage.setItem(DEV_TENANT_OVERRIDE_KEY, tenantId);
}

function getDevTenantOverride(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.sessionStorage.getItem(DEV_TENANT_OVERRIDE_KEY);
}
