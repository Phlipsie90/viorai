export type NavIconName =
  | "dashboard"
  | "customers"
  | "projects"
  | "planner"
  | "tower-planner"
  | "quotes"
  | "admin";

export interface NavItem {
  label: string;
  href: string;
  icon: NavIconName;
}
