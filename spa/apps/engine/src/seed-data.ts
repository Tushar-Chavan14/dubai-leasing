import type { SpaRole } from "@spa/core";

/** One fictional demo user per SPA role (S3). Names and emails are made up; `.test` never delivers mail. */
export const DEMO_USERS: readonly { email: string; name: string; role: SpaRole }[] = [
  { email: "officer@spa-demo.test", name: "Rania Officer", role: "sales_officer" },
  { email: "manager@spa-demo.test", name: "Karim Manager", role: "sales_manager" },
  { email: "salesadmin@spa-demo.test", name: "Lina Salesadmin", role: "sales_admin" },
  { email: "legal@spa-demo.test", name: "Omar Legal", role: "legal" },
  { email: "compliance@spa-demo.test", name: "Sara Compliance", role: "compliance_officer" },
  { email: "mlro@spa-demo.test", name: "Yusuf Mlro", role: "mlro" },
  { email: "finance@spa-demo.test", name: "Huda Finance", role: "finance" },
  { email: "admin@spa-demo.test", name: "Adam Admin", role: "admin" },
];
