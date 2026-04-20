"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { navItems } from "@/data/navigation";
import NavIcon from "@/components/ui/NavIcon";
import { companySettingsRepository } from "@/features/company-settings/repository";

export default function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [companyName, setCompanyName] = useState("Security Suite");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState("#f97352");

  useEffect(() => {
    let mounted = true;

    const loadSettings = async () => {
      try {
        const settings = await companySettingsRepository.get();
        if (!mounted || !settings) {
          return;
        }

        setCompanyName(settings.companyName || "Security Suite");
        setLogoUrl(settings.logoUrl ?? null);
        setPrimaryColor(settings.primaryColor ?? "#f97352");
      } catch {
      }
    };

    loadSettings();
    return () => {
      mounted = false;
    };
  }, []);

  const initials = useMemo(() => {
    const chars = companyName
      .split(" ")
      .map((part) => part.trim()[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
    return chars || "SS";
  }, [companyName]);

  return (
    <aside className="flex flex-col w-64 min-h-screen shrink-0 bg-[#f7f8fb] border-r border-slate-200">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-200">
        {logoUrl ? (
          <div className="w-9 h-9 rounded-xl bg-white overflow-hidden flex items-center justify-center border border-slate-200">
            <img src={logoUrl} alt={companyName} className="w-full h-full object-contain" />
          </div>
        ) : (
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: primaryColor }}>
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-semibold text-2xl leading-tight tracking-tight text-[#172033] truncate">{companyName}</p>
        </div>
      </div>

      <nav className="flex-1 py-5 overflow-y-auto">
        <ul className="space-y-1.5 px-3">
          {navItems.map((item) => {
            const [itemPath, itemQuery] = item.href.split("?");
            const currentQuery = searchParams.toString();
            const isActive = itemQuery
              ? pathname === itemPath && currentQuery === itemQuery
              : pathname === itemPath || pathname.startsWith(itemPath + "/");
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "text-[var(--brand-accent)]"
                      : "text-[#2a3347] hover:bg-white"
                  }`}
                  style={isActive ? { backgroundColor: "#ffe9e3" } : undefined}
                >
                  <NavIcon name={item.icon} className="w-5 h-5 shrink-0" />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-5 py-4 border-t border-slate-200 text-xs text-slate-500">
        ViorAI Suite
      </div>
    </aside>
  );
}
