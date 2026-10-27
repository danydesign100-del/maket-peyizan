export function PageHeader({ title, description }: { title: string; description: string }) {
  return <header className="flex min-h-20 flex-col justify-end border-b border-slate-200 pb-5">
    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-700">Makèt Peyizan · Gestion commerciale</p>
    <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-[28px]">{title}</h1>
    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>
  </header>
}
