import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const tone = {
    primary: "bg-signal text-charcoal",
    secondary: "bg-bone/10 text-bone",
    ghost: "text-bone/70",
  }[variant];
  return <button type="button" className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40 ${tone} ${className}`} {...props} />;
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-[10px] font-semibold tracking-widest text-bone/50 uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] items-baseline gap-2 text-xs">
      <span className="text-bone/50">{label}</span>
      <span className="min-w-0 font-mono break-all text-bone">{children}</span>
    </div>
  );
}
