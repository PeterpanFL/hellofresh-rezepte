import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router-dom'
import RecipeCard from '../components/RecipeCard'
import { useRecipes, useSignedUrls } from '../lib/queries'

export default function RecipeList() {
  const [search, setSearch] = useState('')
  const deferred = useDeferredValue(search)
  const [tag, setTag] = useState<string | null>(null)
  const { data: recipes = [], isLoading, error } = useRecipes(deferred)
  const urls = useSignedUrls(recipes.map((r) => r.hero_path)).data ?? {}

  const tags = [...new Set(recipes.flatMap((r) => r.tags))].sort((a, b) => a.localeCompare(b, 'de'))
  const shown = tag ? recipes.filter((r) => r.tags.includes(tag)) : recipes

  return (
    <div className="space-y-4">
      <input className="input" type="search" placeholder="Suchen: Titel, Zutat, Schritt …" value={search} onChange={(e) => setSearch(e.target.value)} />
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <button key={t} onClick={() => setTag(tag === t ? null : t)} className={`chip ${tag === t ? 'bg-lime-800 text-white' : 'bg-stone-200 text-stone-700'}`}>{t}</button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-700">{(error as Error).message}</p>}
      {!isLoading && shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-600">
          {search ? 'Nichts gefunden.' : <>Noch keine Rezepte. <Link to="/scannen" className="text-lime-800 underline">Ersten Scan hinzufügen</Link></>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((r) => <RecipeCard key={r.id} recipe={r} imageUrl={r.hero_path ? urls[r.hero_path] : undefined} />)}
      </div>
    </div>
  )
}
