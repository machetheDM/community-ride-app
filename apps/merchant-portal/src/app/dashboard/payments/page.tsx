import { redirect } from "next/navigation";
import { DollarSign, CreditCard, Banknote } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";

export const metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const statusVariant: Record<string, "default" | "success" | "warning" | "danger" | "info" | "neutral"> = {
  PENDING: "info",
  COMPLETED: "success",
  FAILED: "danger",
  REFUNDED: "warning",
};

const methodIcon: Record<string, React.ReactNode> = {
  CASH: <Banknote size={14} className="text-emerald-400" />,
  CARD: <CreditCard size={14} className="text-blue-400" />,
  YOCO: <CreditCard size={14} className="text-purple-400" />,
  OZOW: <CreditCard size={14} className="text-cyan-400" />,
  WALLET: <DollarSign size={14} className="text-amber-400" />,
};

export default async function PaymentsPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const payments = await prisma.payment.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: { select: { name: true, phone: true } },
      ride: { select: { id: true, pickupAddress: true, dropoffAddress: true } },
      order: { select: { id: true, store: { select: { name: true } } } },
    },
  });

  const totalRevenue = payments
    .filter((p) => p.status === "COMPLETED")
    .reduce((sum, p) => sum + Number(p.amount), 0);

  const pending = payments.filter((p) => p.status === "PENDING").reduce((s, p) => s + Number(p.amount), 0);
  const failed = payments.filter((p) => p.status === "FAILED").reduce((s, p) => s + Number(p.amount), 0);

  const columns = [
    {
      key: "customer",
      header: "Customer",
      cell: (payment: typeof payments[number]) => (
        <div>
          <p className="text-slate-100 font-semibold">{payment.user.name}</p>
          <p className="text-slate-500 text-xs">{payment.user.phone}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (payment: typeof payments[number]) =>
        payment.ride ? (
          <Badge variant="info">Ride</Badge>
        ) : payment.order ? (
          <Badge variant="neutral">Order · {payment.order.store.name}</Badge>
        ) : (
          <span className="text-slate-500 text-sm">—</span>
        ),
    },
    {
      key: "reference",
      header: "Reference",
      cell: (payment: typeof payments[number]) => (
        <span className="text-slate-400 text-xs font-mono">
          {payment.reference ? payment.reference.slice(0, 12) + "…" : "—"}
        </span>
      ),
    },
    {
      key: "method",
      header: "Method",
      align: "center" as const,
      cell: (payment: typeof payments[number]) => (
        <div className="flex items-center justify-center gap-1.5">
          {methodIcon[payment.method] ?? <CreditCard size={14} className="text-slate-400" />}
          <span className="text-slate-300 text-xs">{payment.method}</span>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right" as const,
      cell: (payment: typeof payments[number]) => (
        <span className="text-slate-100 font-medium">R {Number(payment.amount).toFixed(2)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      align: "center" as const,
      cell: (payment: typeof payments[number]) => (
        <Badge variant={statusVariant[payment.status] ?? "neutral"}>{payment.status}</Badge>
      ),
    },
    {
      key: "date",
      header: "Date",
      align: "right" as const,
      cell: (payment: typeof payments[number]) => (
        <span className="text-slate-400 text-xs">
          {new Date(payment.createdAt).toLocaleDateString("en-ZA", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ),
    },
  ];

  return (
    <div className="p-8">
      <PageHeader title="Payments" subtitle={`${payments.length} transactions`} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <StatCard label="Total Revenue" value={`R ${totalRevenue.toFixed(2)}`} icon={DollarSign} color="emerald" />
        <StatCard label="Pending" value={`R ${pending.toFixed(2)}`} icon={CreditCard} color="blue" />
        <StatCard label="Failed" value={`R ${failed.toFixed(2)}`} icon={CreditCard} color="red" />
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          rows={payments}
          keyExtractor={(payment) => payment.id}
          empty={<EmptyState icon={<DollarSign size={40} className="text-slate-600" />} title="No payments yet" description="Transactions will appear here once customers pay." />}
        />
      </Card>
    </div>
  );
}
