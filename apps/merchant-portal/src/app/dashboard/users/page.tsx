import { redirect } from "next/navigation";
import { Users, Wallet } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";

export const metadata = { title: "Users" };
export const dynamic = "force-dynamic";

const roleColors: Record<string, { variant: "default" | "success" | "warning" | "danger" | "info" | "neutral"; iconColor: string }> = {
  CUSTOMER: { variant: "info", iconColor: "text-blue-400" },
  DRIVER: { variant: "success", iconColor: "text-emerald-400" },
  RIDER: { variant: "warning", iconColor: "text-orange-400" },
  MERCHANT: { variant: "default", iconColor: "text-amber-400" },
  ADMIN: { variant: "danger", iconColor: "text-purple-400" },
};

// Badge variants and StatCard colours are separate vocabularies. Feeding a Badge
// variant straight into StatCard leaves colorMap[color] undefined and throws on
// render, so roles map to StatCard's palette explicitly.
const roleStatColor: Record<string, "amber" | "blue" | "emerald" | "purple" | "red" | "cyan"> = {
  CUSTOMER: "blue",
  DRIVER: "emerald",
  RIDER: "amber",
  MERCHANT: "amber",
  ADMIN: "purple",
};

export default async function UsersPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      driverProfile: { select: { isApproved: true } },
      riderProfile: { select: { isApproved: true } },
      merchantProfile: { select: { isApproved: true } },
      _count: { select: { rides: true, orders: true } },
    },
  });

  const roleCounts = users.reduce(
    (acc, u) => {
      acc[u.role] = (acc[u.role] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const totalWallet = users.reduce((sum, u) => sum + Number(u.walletBalance), 0);

  const columns = [
    {
      key: "user",
      header: "User",
      cell: (user: typeof users[number]) => (
        <div className="flex items-center gap-3">
          <Avatar name={user.name} size="md" />
          <div>
            <p className="text-slate-100 font-semibold">{user.name}</p>
            {user.email && <p className="text-slate-500 text-xs">{user.email}</p>}
          </div>
        </div>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      cell: (user: typeof users[number]) => (
        <span className="text-slate-300 text-xs font-mono">{user.phone}</span>
      ),
    },
    {
      key: "role",
      header: "Role",
      align: "center" as const,
      cell: (user: typeof users[number]) => {
        const config = roleColors[user.role] ?? { variant: "neutral" as const, iconColor: "text-slate-400" };
        return <Badge variant={config.variant}>{user.role}</Badge>;
      },
    },
    {
      key: "verified",
      header: "Verified",
      align: "center" as const,
      cell: (user: typeof users[number]) => (
        <Badge variant={user.isVerified ? "success" : "neutral"}>
          {user.isVerified ? "Verified" : "Pending"}
        </Badge>
      ),
    },
    {
      key: "active",
      header: "Active",
      align: "center" as const,
      cell: (user: typeof users[number]) => (
        <Badge variant={user.isActive ? "success" : "danger"} dot>
          {user.isActive ? "Active" : "Suspended"}
        </Badge>
      ),
    },
    {
      key: "rides",
      header: "Rides",
      align: "center" as const,
      cell: (user: typeof users[number]) => (
        <span className="text-slate-200 font-medium text-sm">{user._count.rides}</span>
      ),
    },
    {
      key: "orders",
      header: "Orders",
      align: "center" as const,
      cell: (user: typeof users[number]) => (
        <span className="text-slate-200 font-medium text-sm">{user._count.orders}</span>
      ),
    },
    {
      key: "wallet",
      header: "Wallet",
      align: "right" as const,
      cell: (user: typeof users[number]) => (
        <span className="text-slate-200 font-medium">R {Number(user.walletBalance).toFixed(2)}</span>
      ),
    },
  ];

  return (
    <div className="p-8">
      <PageHeader title="Users" subtitle={`${users.length} users registered`} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <StatCard label="Total Users" value={users.length.toString()} icon={Users} color="blue" />
        <StatCard label="Total Wallet" value={`R ${totalWallet.toFixed(2)}`} icon={Wallet} color="emerald" />
        {Object.entries(roleCounts).map(([role, count]) => (
          <StatCard key={role} label={role} value={count.toString()} icon={Users} color={roleStatColor[role] ?? "cyan"} />
        ))}
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={users}
          keyExtractor={(user) => user.id}
          empty={<EmptyState icon={<Users size={40} className="text-slate-600" />} title="No users yet" description="Users will appear once they sign up." />}
        />
      </Card>
    </div>
  );
}
