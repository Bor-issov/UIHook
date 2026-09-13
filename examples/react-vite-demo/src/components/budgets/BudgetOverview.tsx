import { BudgetCard } from "./BudgetCard";

const budgets = [
  { label: "Housing", spent: 1840, limit: 2000 },
  { label: "Groceries", spent: 412, limit: 600 },
  { label: "Transport", spent: 96, limit: 250 },
  { label: "Subscriptions", spent: 74, limit: 80, highlighted: true },
];

export function BudgetOverview() {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">Categories</h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {budgets.map((budget) => (
          <BudgetCard key={budget.label} {...budget} />
        ))}
      </div>
    </section>
  );
}
