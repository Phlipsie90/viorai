"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { navItems } from "@/data/navigation";
import { getSupabaseClient, getSupabaseUserSafe } from "@/lib/supabase/client";

function getPageTitle(pathname: string, query: string): string {
  const match = navItems.find((item) => {
    const [itemPath, itemQuery] = item.href.split("?");
    if (itemQuery) {
      return pathname === itemPath && query === itemQuery;
    }
    return pathname === itemPath || pathname.startsWith(itemPath + "/");
  });
  return match?.label ?? "Übersicht";
}

export default function Topbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseClient(), []);
  const [userLabel, setUserLabel] = useState("US");
  const [userName, setUserName] = useState("Nutzer");
  const [isSigningOut, setIsSigningOut] = useState(false);
  const title = getPageTitle(pathname, searchParams.toString());

  useEffect(() => {
    let mounted = true;

    const loadUser = async () => {
      const {
        data: { user },
      } = await getSupabaseUserSafe(supabase);

      if (!mounted) {
        return;
      }

      const metadata = user?.user_metadata as Record<string, unknown> | undefined;
      const resolvedName =
        (typeof metadata?.full_name === "string" && metadata.full_name.trim())
        || (typeof metadata?.name === "string" && metadata.name.trim())
        || (typeof metadata?.display_name === "string" && metadata.display_name.trim())
        || user?.email
        || "Nutzer";
      const source = resolvedName || "User";
      const initials = source
        .split(/\s+|@|\./)
        .map((part: string) => part.trim()[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();

      setUserName(resolvedName);
      setUserLabel(initials || "US");
    };

    loadUser();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
      router.replace("/auth");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <header className="flex items-center justify-between h-16 px-6 bg-white border-b border-slate-200 shrink-0">
      <div className="flex items-center gap-4 min-w-0">
        <h1 className="text-lg font-semibold text-[var(--text-strong)] truncate">{title}</h1>
        <div className="hidden md:flex items-center min-w-[280px]">
          <input
            type="search"
            placeholder="Suchen..."
            className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => router.push("/planner")}
          className="inline-flex items-center rounded-lg bg-[var(--brand-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:brightness-95"
        >
          Neues Angebot erstellen
        </button>
        <div className="hidden sm:flex items-center gap-2 rounded-lg px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center text-xs font-semibold uppercase">
            {userLabel}
          </div>
          <span className="text-sm text-[var(--text-strong)] max-w-[150px] truncate">{userName}</span>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="text-xs text-slate-500 rounded-lg px-2 py-1 hover:bg-slate-100 disabled:opacity-60"
        >
          {isSigningOut ? "Abmelden..." : "Abmelden"}
        </button>
      </div>
    </header>
  );
}
