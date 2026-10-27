import { PageHeader } from './PageHeader'
export function ModulePlaceholder({ title, description }: { title: string; description: string }) { return <><PageHeader title={title} description={description} /><section className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">Ce module sera développé lors de l’étape métier correspondante.</section></> }
