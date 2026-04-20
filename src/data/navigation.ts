import { NavItem } from "@/types/navigation";

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Kunden", href: "/customers", icon: "customers" },
  { label: "Projekte", href: "/projects", icon: "projects" },
  { label: "Angebote", href: "/quotes", icon: "quotes" },
  { label: "Voreinstellungen", href: "/admin?bereich=voreinstellungen", icon: "admin" },
  { label: "Admin", href: "/admin?bereich=admin", icon: "admin" },
];
