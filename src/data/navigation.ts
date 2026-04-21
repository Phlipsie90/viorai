import { NavItem } from "@/types/navigation";

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Angebote", href: "/quotes", icon: "quotes" },
  { label: "Einstellungen", href: "/admin?bereich=voreinstellungen", icon: "admin" },
];
