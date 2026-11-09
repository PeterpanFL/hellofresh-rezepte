import { Link } from 'react-router-dom'
import type { Recipe } from '../lib/types'

export function minutesLabel(r: Pick<Recipe, 'minutes_min' | 'minutes_max'>) {
  if (r.minutes_min && r.minutes_max && r.minutes_min !== r.minutes_max) return `${r.minutes_min}–${r.minutes_max} Min`
  const m = r.minutes_max ?? r.minutes_min
  return m ? `${m} Min` : null
}

const STATUS: Record<Recipe['status'], { label: string; cls: string } | null> = {
  new: { label: 'wird gelesen', cls: 'bg-stone-200 text-stone-700' },
  extracted: { label: 'ungeprüft', cls: 'bg-amber-100 text-amber-900' },
  checked: null,
  failed: { label: 'Fehler', cls: 'bg-red-100 text-red-800' },
}

export default function RecipeCard({ recipe, imageUrl, footer }: { recipe: Recipe; imageUrl?: string; footer?: React.ReactNode }) {
  const status = STATUS[recipe.status]
  const time = minutesLabel(recipe)
  return (
    <Link to={`/rezept/${recipe.id}`} className="group overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 transition hover:shadow-md">
      <div className="relative aspect-[4/3] bg-stone-200">
        {imageUrl && <img src={imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />}
        {recipe.card_number != null && (
          <span className="absolute right-2 top-2 rounded-md bg-orange-500 px-2 py-0.5 text-sm font-bold text-white">{recipe.card_number}</span>
        )}
      </div>
      <div className="space-y-1 p-3">
        <h3 className="line-clamp-2 font-medium leading-snug group-hover:text-lime-900">{recipe.title}</h3>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-500">
          {time && <span>{time}</span>}
          {recipe.kcal && <span>· {recipe.kcal} kcal</span>}
          {status && <span className={`chip ${status.cls}`}>{status.label}</span>}
          {recipe.duplicate_of && <span className="chip bg-violet-100 text-violet-800">Dublette</span>}
        </div>
        {footer}
      </div>
    </Link>
  )
}
