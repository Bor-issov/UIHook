import { BudgetOverview } from "@/components/budgets/BudgetOverview";

export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-8 py-12">
      <header className="flex items-end justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-semibold tracking-tight">Ledger</h1>
          <p className="text-bone-muted">September budget, updated hourly</p>
        </div>
        <button className="rounded-lg bg-signal px-4 py-2 text-sm font-medium text-charcoal">Add expense</button>
      </header>
      <BudgetOverview />
    </main>
  );
}
