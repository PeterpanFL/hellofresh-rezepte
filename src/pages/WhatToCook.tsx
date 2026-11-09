import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import RecipeCard from '../components/RecipeCard'
import { keys, useIngredientNames, useMatch, usePantry, useRecipes, useSignedUrls } from '../lib/queries'
import { supabase } from '../lib/supabase'
import type { MatchRow } from '../lib/types'

const GROUPS: { title: string; test: (m: MatchRow) => boolean }[] = [
  { title: 'Alles da', test: (m) => m.missing_count === 0 },
  { title: 'Fehlt 1 bis 2', test: (m) => m.missing_count > 0 && m.missing_count <= 2 },
  { title: 'Fehlt mehr', test: (m) => m.missing_count > 2 },
]

export default function WhatToCook() {
  const { data: pantry = [] } = usePantry()
  const { data: names = [] } = useIngredientNames()
  const { data: recipes = [] } = useRecipes('')
  const { data: matches = [], isFetching } = useMatch(pantry)
  const urls = useSignedUrls(recipes.map((r) => r.hero_path)).data ?? {}
  const [input, setInput] = useState('')
  const qc = useQueryClient()

  const byId = new Map(recipes.map((r) => [r.id, r]))
  const refresh = () => qc.invalidateQueries({ queryKey: keys.pantry })

  async function add(raw: string) {
    const items = raw.split(',').map((s) => s.trim()).filter(Boolean)
    if (!items.length) return
    await supabase.from('recipe_pantry').upsert(items.map((name) => ({ name })), { onConflict: 'user_id,name', ignoreDuplicates: true })
    setInput('')
    refresh()
  }
  async function remove(name: string) {
    await supabase.from('recipe_pantry').delete().eq('name', name)
    refresh()
  }
  async function clear() {
    if (!confirm('Vorratsliste leeren?')) return
    await supabase.from('recipe_pantry').delete().in('name', pantry)
    refresh()
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
        <h1 className="font-semibold">Was hast du da?</h1>
        <form onSubmit={(e) => { e.preventDefault(); add(input) }} className="flex gap-2">
          <input className="input" list="ingredient-names" placeholder="z. B. Kirschtomaten, Mozzarella" value={input} onChange={(e) => setInput(e.target.value)} />
          <button className="btn-primary">Hinzufügen</button>
          <datalist id="ingredient-names">{names.filter((n) => !pantry.includes(n)).map((n) => <option key={n} value={n} />)}</datalist>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {pantry.map((p) => (
            <button key={p} onClick={() => remove(p)} className="chip bg-lime-100 text-lime-900 hover:bg-lime-200" title="Entfernen">{p} ×</button>
          ))}
          {pantry.length > 1 && <button onClick={clear} className="chip text-stone-500 hover:bg-stone-100">alle entfernen</button>}
        </div>
        {names.length > 0 && pantry.length === 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <span className="text-xs text-stone-500">Häufig:</span>
            {names.slice(0, 12).map((n) => <button key={n} onClick={() => add(n)} className="chip bg-stone-100 text-stone-700 hover:bg-stone-200">+ {n}</button>)}
          </div>
        )}
        <p className="text-xs text-stone-500">Salz, Pfeffer, Öl, Butter und andere Basiszutaten zählen immer als vorhanden.</p>
      </section>

      {pantry.length > 0 && !isFetching && matches.length === 0 && (
        <p className="text-sm text-stone-600">Kein Rezept nutzt eine dieser Zutaten.</p>
      )}

      {GROUPS.map((g) => {
        const list = matches.filter(g.test).filter((m) => byId.has(m.recipe_id))
        if (!list.length) return null
        return (
          <section key={g.title} className="space-y-2">
            <h2 className="font-semibold">{g.title} <span className="font-normal text-stone-500">({list.length})</span></h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {list.map((m) => {
                const r = byId.get(m.recipe_id)!
                return (
                  <RecipeCard
                    key={m.recipe_id}
                    recipe={r}
                    imageUrl={r.hero_path ? urls[r.hero_path] : undefined}
                    footer={
                      <p className="text-xs text-stone-600">
                        {m.have_count} von {m.total} da
                        {m.missing.length > 0 && <span className="block text-red-700">fehlt: {m.missing.join(', ')}</span>}
                      </p>
                    }
                  />
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
