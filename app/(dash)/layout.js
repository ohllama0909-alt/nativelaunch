import { DashboardShell } from '@/components/dashboard-shell';

export const metadata = {
  title: 'Control plane',
};

export default function DashboardLayout({ children }) {
  return <DashboardShell>{children}</DashboardShell>;
}
