import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { minutesLabel } from '../components/RecipeCard'
import { reExtract, type ImportPhase } from '../lib/importRecipe'
import { useRecipe, useSignedUrls } from '../lib/queries'
import { BUCKET, supabase } from '../lib/supabase'
import type { RecipeIngredient } from '../lib/types'

type Persons = 2 | 3 | 4

export default function RecipeDetail() {
  const { id = '' } = useParams()
  const { data, isLoading, error, refetch } = useRecipe(id)
  const [persons, setPersons] = useState<Persons>(2)
  const [asImage, setAsImage] = useState(true)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const qc = useQueryClient()
  const navigate = useNavigate()

  const r = data?.recipe
  const urls = useSignedUrls([r?.hero_path, r?.ingredients_path, r?.pdf_path, r?.front_path, r?.back_path, ...(data?.steps.map((s) => s.image_path) ?? [])]).data ?? {}

  if (isLoading) return <p className="text-sm text-stone-500">Lädt …</p>
  if (error || !data || !r) return <p className="text-sm text-red-700">{(error as Error)?.message ?? 'Nicht gefunden'}</p>

  const amount = (i: RecipeIngredient) => (persons === 2 ? i.amount_2p : persons === 3 ? i.amount_3p : i.amount_4p) ?? '–'
  const time = minutesLabel(r)

  async function retry() {
    if (!r?.front_path || !r.back_path) return
    try {
      await reExtract(r.id, r.front_path, r.back_path, (p: ImportPhase) => setBusy(p === 'done' ? null : 'Wird neu gelesen …'))
    } catch (e) {
      alert((e as Error).message)
    }
    setBusy(null)
    refetch()
    qc.invalidateQueries({ queryKey: ['recipes'] })
  }

  async function markChecked() {
    await supabase.from('recipes').update({ status: 'checked' }).eq('id', id)
    refetch()
    qc.invalidateQueries({ queryKey: ['recipes'] })
  }

  async function remove() {
    if (!r || !confirm(`„${r.title}“ mit allen Bildern löschen?`)) return
    const folder = r.front_path?.replace(/\/front\.jpg$/, '')
    if (folder) {
      const { data: files } = await supabase.storage.from(BUCKET).list(folder)
      if (files?.length) await supabase.storage.from(BUCKET).remove(files.map((f) => `${folder}/${f.name}`))
    }
    await supabase.from('recipes').delete().eq('id', r.id)
    qc.invalidateQueries({ queryKey: ['recipes'] })
    navigate('/')
  }

  return (
    <article className="space-y-6">
      <div className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
        {r.hero_path && urls[r.hero_path] && <img src={urls[r.hero_path]} alt="" className="aspect-[16/9] w-full object-cover" />}
        <div className="space-y-2 p-4">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h1 className="text-xl font-semibold leading-tight">{r.title}</h1>
              {r.subtitle && <p className="text-stone-600">{r.subtitle}</p>}
            </div>
            {r.card_number != null && <span className="rounded-lg bg-orange-500 px-3 py-1 text-lg font-bold text-white">{r.card_number}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-sm text-stone-600">
            {r.tags.map((t) => <span key={t} className="chip bg-lime-100 text-lime-900">{t}</span>)}
            {time && <span>{time}</span>}
            {r.kcal && <span>· {r.kcal} kcal</span>}
          </div>
          {r.duplicate_of && (
            <p className="rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-900">
              Dieses Rezept gibt es schon. <Link to={`/rezept/${r.duplicate_of}`} className="underline">Zum älteren Scan</Link>; einen der beiden kannst du löschen.
            </p>
          )}
          {r.status === 'failed' && <p className="text-sm text-red-700">Auslesen fehlgeschlagen: {r.extraction_error}</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {r.status === 'extracted' && <button className="btn-primary" onClick={markChecked}>Geprüft</button>}
            {(r.status === 'failed' || r.status === 'extracted') && <button className="btn-ghost" onClick={retry} disabled={!!busy}>{busy ?? 'Neu auslesen'}</button>}
            <button className="btn-ghost" onClick={() => setEditing((e) => !e)}>{editing ? 'Fertig' : 'Zutaten bearbeiten'}</button>
            {r.pdf_path && urls[r.pdf_path] && <a className="btn-ghost" href={urls[r.pdf_path]} target="_blank" rel="noreferrer">Original-PDF</a>}
            <button className="btn-ghost text-red-700" onClick={remove}>Löschen</button>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">Zutaten</h2>
          <Segmented value={persons} options={[2, 3, 4]} label={(p) => `${p} P`} onChange={setPersons} />
          <Segmented value={asImage} options={[true, false]} label={(v) => (v ? 'Bild' : 'Text')} onChange={setAsImage} />
        </div>
        {editing ? (
          <IngredientEditor ingredients={data.ingredients} onSaved={() => { refetch(); qc.invalidateQueries({ queryKey: ['ingredient-names'] }) }} />
        ) : asImage && r.ingredients_path && urls[r.ingredients_path] ? (
          <img src={urls[r.ingredients_path]} alt="Zutaten wie auf der Karte" className="max-h-[80vh] rounded-2xl bg-white ring-1 ring-stone-200" />
        ) : (
          <table className="w-full overflow-hidden rounded-2xl bg-white text-sm ring-1 ring-stone-200">
            <tbody className="divide-y divide-stone-100">
              {data.ingredients.map((i) => (
                <tr key={i.id}>
                  <td className="px-4 py-2">{i.name}<span className="block text-xs text-stone-500">{i.original_name}</span></td>
                  <td className="px-4 py-2 text-right tabular-nums">{amount(i)}</td>
                </tr>
              ))}
              {r.pantry_note && <tr><td colSpan={2} className="px-4 py-2 text-xs text-stone-500">Aus deiner Küche: {r.pantry_note}</td></tr>}
            </tbody>
          </table>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Kochanleitung</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.steps.map((s) => (
            <li key={s.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-stone-200">
              {asImage && s.image_path && urls[s.image_path] ? (
                <img src={urls[s.image_path]} alt={`Schritt ${s.step_number}: ${s.title ?? ''}`} className="w-full" />
              ) : (
                <div className="space-y-1 p-4 text-sm">
                  <h3 className="font-semibold text-lime-900">{s.step_number}. {s.title}</h3>
                  <p className="whitespace-pre-line text-stone-700">{s.body}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
        {data.steps.length === 0 && r.back_path && urls[r.back_path] && <img src={urls[r.back_path]} alt="Rückseite" className="rounded-2xl ring-1 ring-stone-200" />}
      </section>

      {r.nutrition.length > 0 && (
        <details className="rounded-2xl bg-white p-4 text-sm ring-1 ring-stone-200">
          <summary className="cursor-pointer font-medium">Nährwerte und Allergene</summary>
          <table className="mt-2 w-full">
            <thead className="text-xs text-stone-500"><tr><th className="text-left font-normal" /><th className="text-right font-normal">100 g</th><th className="text-right font-normal">Portion</th></tr></thead>
            <tbody>{r.nutrition.map((n) => <tr key={n.name}><td>{n.name}</td><td className="text-right tabular-nums">{n.per_100g}</td><td className="text-right tabular-nums">{n.per_portion}</td></tr>)}</tbody>
          </table>
          {r.allergens && <p className="mt-2 text-xs text-stone-600">{r.allergens}</p>}
        </details>
      )}
    </article>
  )
}

function Segmented<T extends string | number | boolean>({ value, options, label, onChange }: { value: T; options: T[]; label: (v: T) => string; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-stone-200 p-0.5 text-sm">
      {options.map((o) => (
        <button key={String(o)} onClick={() => onChange(o)} className={`rounded-md px-3 py-1 ${o === value ? 'bg-white shadow-sm' : 'text-stone-600'}`}>{label(o)}</button>
      ))}
    </div>
  )
}

/** Lets the user fix the normalised names the search uses, and mark staples. */
function IngredientEditor({ ingredients, onSaved }: { ingredients: RecipeIngredient[]; onSaved: () => void }) {
  const [rows, setRows] = useState(ingredients.map((i) => ({ id: i.id, original: i.original_name, name: i.name, is_pantry: i.is_pantry })))
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    for (const row of rows) {
      const before = ingredients.find((i) => i.id === row.id)
      if (before && (before.name !== row.name.trim() || before.is_pantry !== row.is_pantry)) {
        await supabase.from('recipe_ingredients').update({ name: row.name.trim(), is_pantry: row.is_pantry }).eq('id', row.id)
      }
    }
    if (ingredients[0]) await supabase.rpc('recipe_refresh_search', { p_recipe_id: ingredients[0].recipe_id })
    setSaving(false)
    onSaved()
  }

  return (
    <div className="space-y-2 rounded-2xl bg-white p-4 ring-1 ring-stone-200">
      <p className="text-xs text-stone-500">Der Suchname wird für „Was koche ich?“ verwendet. Basiszutaten zählen nie als fehlend.</p>
      {rows.map((row, k) => (
        <div key={row.id} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <span className="hidden truncate text-sm text-stone-500 sm:block">{row.original}</span>
          <input className="input" value={row.name} onChange={(e) => setRows((r) => r.map((x, i) => (i === k ? { ...x, name: e.target.value } : x)))} />
          <label className="flex items-center gap-1 text-xs text-stone-600">
            <input type="checkbox" checked={row.is_pantry} onChange={(e) => setRows((r) => r.map((x, i) => (i === k ? { ...x, is_pantry: e.target.checked } : x)))} />
            Basis
          </label>
        </div>
      ))}
      <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Speichert …' : 'Speichern'}</button>
    </div>
  )
}
