"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { getSupabaseClient, getSupabaseSessionSafe } from "@/lib/supabase/client";
import { tryResolveTenantContext } from "@/lib/supabase/tenant-context";

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hasTenantContext, setHasTenantContext] = useState(false);
  const currentYear = new Date().getFullYear();

  const isAuthRoute = pathname.startsWith("/auth");

  useEffect(() => {
    let mounted = true;
    let latestPathname = pathname;

    const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("bootstrap_timeout")), timeoutMs);
      });

      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }
    };

    const applyResolvedState = (authenticated: boolean, tenantAvailable: boolean, currentPath: string) => {
      if (!mounted) {
        return;
      }

      setIsAuthenticated(authenticated);
      setHasTenantContext(tenantAvailable);
      setIsChecking(false);

      const currentIsAuthRoute = currentPath.startsWith("/auth");
      if (!authenticated) {
        if (!currentIsAuthRoute) {
          router.replace("/auth");
        }
        return;
      }

      if (currentIsAuthRoute) {
        if (tenantAvailable) {
          router.replace("/dashboard");
        }
        return;
      }

      if (!tenantAvailable) {
        router.replace("/auth?mode=setup");
      }
    };

    const resolveAppAccess = async (currentPath: string, sessionOverride?: { user?: { id?: string } } | null) => {
      try {
        const session =
          sessionOverride === undefined
            ? (await withTimeout(getSupabaseSessionSafe(supabase), 10000)).data.session
            : sessionOverride;

        if (!session) {
          applyResolvedState(false, false, currentPath);
          return;
        }

        let tenantAvailable = false;
        try {
          const tenant = await withTimeout(tryResolveTenantContext(supabase), 10000);
          tenantAvailable = !!tenant;
        } catch {
          tenantAvailable = false;
        }

        applyResolvedState(true, tenantAvailable, currentPath);
      } catch {
        applyResolvedState(false, false, currentPath);
      }
    };

    resolveAppAccess(pathname);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      latestPathname = window.location.pathname;
      window.setTimeout(() => {
        if (!mounted) {
          return;
        }

        void resolveAppAccess(latestPathname, session).catch(() => {
          applyResolvedState(false, false, latestPathname);
        });
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [isAuthRoute, pathname, router, supabase]);

  if (isAuthRoute) {
    return <>{children}</>;
  }

  if (isChecking) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-5 text-sm text-slate-600">Lade Anwendung...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-lg px-6 py-5 text-sm text-slate-600">Weiterleitung zur Anmeldung...</div>
      </div>
    );
  }

  if (!hasTenantContext) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-lg p-6 max-w-xl w-full space-y-3">
          <h2 className="text-lg font-semibold text-slate-800">Tenant-Setup erforderlich</h2>
          <p className="text-sm text-slate-600">Für dieses Konto wurde noch kein Tenant bereitgestellt.</p>
          <button
            type="button"
            onClick={() => router.replace("/auth?mode=setup")}
            className="inline-flex items-center justify-center rounded-md bg-blue-600 text-white text-sm px-4 py-2 hover:bg-blue-700"
          >
            Setup öffnen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6 bg-[var(--surface-app)]">{children}</main>
        <footer
          className="border-t border-slate-200 bg-[var(--surface-app)] py-2 text-center text-xs text-slate-500/70"
          title={`© ${currentYear} ViorAI (Phillipp Reiß) – Angebotsplattform`}
        >
          © {currentYear} ViorAI (Phillipp Reiß)
        </footer>
      </div>
    </div>
  );
}
