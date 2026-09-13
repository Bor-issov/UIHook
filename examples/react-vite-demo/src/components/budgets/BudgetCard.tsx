import { cn } from "@/lib/cn";

export interface BudgetCardProps {
  label: string;
  spent: number;
  limit: number;
  highlighted?: boolean;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function BudgetCard({ label, spent, limit, highlighted = false }: BudgetCardProps) {
  const ratio = Math.min(spent / limit, 1);

  return (
    <article className={cn("flex flex-col gap-6 rounded-xl bg-charcoal-raised p-6", highlighted && "bg-charcoal-deep")}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm text-bone-muted">{label}</h3>
        <span className="text-xs text-bone-muted">{Math.round(ratio * 100)}%</span>
      </div>
      <p className="text-2xl font-semibold">{currency.format(spent)}</p>
      <div className="h-1.5 rounded-full bg-charcoal-deep">
        <div className="h-full rounded-full bg-signal" style={{ width: `${ratio * 100}%` }} />
      </div>
      <p className="text-xs text-bone-muted">of {currency.format(limit)}</p>
    </article>
  );
}
