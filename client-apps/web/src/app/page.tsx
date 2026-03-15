import { TopBar } from "@/components/layout/TopBar";
import { ResourceOverview } from "@/components/dashboard/ResourceOverview";
import { QuickActions } from "@/components/dashboard/QuickActions";
import { RecentSessions } from "@/components/dashboard/RecentSessions";

export default function DashboardPage() {
  return (
    <>
      <TopBar title="Dashboard" description="Your organization at a glance" />

      <div className="space-y-8">
        <ResourceOverview />
        <QuickActions />
        <RecentSessions />
      </div>
    </>
  );
}
