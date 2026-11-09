import { BUCKET, supabase } from './supabase'
import { LAYOUT, blobToBase64, crop, renderPdfPages, toJpeg } from './pdf'
import type { ExtractedRecipe } from './types'

/** Ingredients that are always at home and never count as missing. */
export const PANTRY_STAPLES = [
  'salz', 'pfeffer', 'zucker', 'öl', 'olivenöl', 'sonnenblumenöl', 'rapsöl', 'butter', 'wasser',
  'essig', 'weißweinessig', 'balsamico', 'mehl', 'senf', 'honig',
]

export function isPantryStaple(name: string, pantryItems: string[] = []): boolean {
  const n = name.trim().toLowerCase()
  return PANTRY_STAPLES.includes(n) || pantryItems.some((p) => p.trim().toLowerCase() === n)
}

export type ImportPhase = 'render' | 'upload' | 'extract' | 'save' | 'done' | 'error'

/** Thrown when exactly this PDF was imported before. */
export class DuplicateFileError extends Error {
  existingId: string
  constructor(existingId: string, title: string) {
    super(`Schon vorhanden: ${title}`)
    this.existingId = existingId
  }
}

/** The recipe was stored, but reading its text failed; it can be retried from the detail page. */
export class ExtractionError extends Error {
  recipeId: string
  constructor(recipeId: string, message: string) {
    super(`Auslesen fehlgeschlagen: ${message}`)
    this.recipeId = recipeId
  }
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Imports one scanned card: renders the PDF, cuts out hero / ingredients / step images, uploads everything,
 * has the Edge Function read the text and stores the result. A failed extraction keeps the recipe with
 * status "failed" so it can be retried from the detail page.
 */
export async function importRecipePdf(file: File, onPhase: (p: ImportPhase) => void): Promise<string> {
  const { data: auth } = await supabase.auth.getUser()
  const userId = auth.user?.id
  if (!userId) throw new Error('Nicht angemeldet')

  const hash = await sha256(file)
  const { data: same } = await supabase.from('recipes').select('id, title').eq('pdf_sha256', hash).limit(1)
  if (same?.length) throw new DuplicateFileError(same[0].id, same[0].title)

  onPhase('render')
  const pages = await renderPdfPages(file)
  if (pages.length < 2) throw new Error('Das PDF braucht Vorder- und Rückseite (2 Seiten).')
  const [front, back] = pages

  const { data: recipe, error } = await supabase
    .from('recipes')
    .insert({ title: file.name.replace(/\.pdf$/i, ''), status: 'new', pdf_sha256: hash })
    .select('id')
    .single()
  if (error) throw error
  const id = recipe.id as string
  const dir = `${userId}/${id}`

  onPhase('upload')
  const images: Record<string, Blob> = {
    'front.jpg': await toJpeg(front),
    'back.jpg': await toJpeg(back),
    'hero.jpg': await toJpeg(crop(front, LAYOUT.hero)),
    'ingredients.jpg': await toJpeg(crop(back, LAYOUT.ingredients)),
  }
  for (let i = 0; i < LAYOUT.steps.length; i++) images[`step-${i + 1}.jpg`] = await toJpeg(crop(back, LAYOUT.steps[i]))

  await upload(`${dir}/original.pdf`, file, 'application/pdf')
  for (const [name, blob] of Object.entries(images)) await upload(`${dir}/${name}`, blob, 'image/jpeg')

  await supabase.from('recipes').update({
    pdf_path: `${dir}/original.pdf`,
    front_path: `${dir}/front.jpg`,
    back_path: `${dir}/back.jpg`,
    hero_path: `${dir}/hero.jpg`,
    ingredients_path: `${dir}/ingredients.jpg`,
  }).eq('id', id)

  await extractAndSave(id, images['front.jpg'], images['back.jpg'], onPhase)
  return id
}

/** Runs the extraction again from the stored page images (e.g. after a failure). */
export async function reExtract(recipeId: string, frontPath: string, backPath: string, onPhase: (p: ImportPhase) => void) {
  const [f, b] = await Promise.all([
    supabase.storage.from(BUCKET).download(frontPath),
    supabase.storage.from(BUCKET).download(backPath),
  ])
  if (f.error || b.error) throw f.error ?? b.error
  await extractAndSave(recipeId, f.data, b.data, onPhase)
}

async function extractAndSave(id: string, front: Blob, back: Blob, onPhase: (p: ImportPhase) => void) {
  onPhase('extract')
  const { data, error } = await supabase.functions.invoke<{ recipe: ExtractedRecipe }>('recipe-ocr', {
    body: { front: await blobToBase64(front), back: await blobToBase64(back) },
  })
  if (error || !data?.recipe) {
    let message = error?.message ?? 'Keine Daten erkannt'
    // FunctionsHttpError carries the function's own JSON answer in `context`.
    const ctx = (error as { context?: Response } | null)?.context
    if (ctx && typeof ctx.json === 'function') {
      try { message = (await ctx.json())?.error ?? message } catch { /* keep generic message */ }
    }
    await supabase.from('recipes').update({ status: 'failed', extraction_error: message }).eq('id', id)
    onPhase('error')
    throw new ExtractionError(id, message)
  }

  onPhase('save')
  const r = data.recipe
  // A different scan of a card that is already stored: keep it, but point to the older one.
  const { data: older } = await supabase
    .from('recipes').select('id').ilike('title', r.title.replace(/[%_\\]/g, '\\$&')).neq('id', id)
    .order('created_at').limit(1)
  const dir = (await supabase.from('recipes').select('front_path').eq('id', id).single()).data?.front_path?.replace(/\/front\.jpg$/, '')
  const { error: upErr } = await supabase.from('recipes').update({
    card_number: r.card_number,
    title: r.title,
    subtitle: r.subtitle,
    tags: r.tags,
    minutes_min: r.minutes_min,
    minutes_max: r.minutes_max,
    kcal: r.kcal,
    pantry_note: r.pantry_items.join(', ') || null,
    nutrition: r.nutrition,
    allergens: r.allergens,
    status: 'extracted',
    extraction_error: null,
    duplicate_of: older?.[0]?.id ?? null,
  }).eq('id', id)
  if (upErr) throw upErr

  await supabase.from('recipe_ingredients').delete().eq('recipe_id', id)
  await supabase.from('recipe_steps').delete().eq('recipe_id', id)

  if (r.ingredients.length) {
    const { error: e } = await supabase.from('recipe_ingredients').insert(
      r.ingredients.map((ing, position) => ({
        recipe_id: id,
        position,
        original_name: ing.original_name,
        name: ing.name,
        amount_2p: ing.amount_2p,
        amount_3p: ing.amount_3p,
        amount_4p: ing.amount_4p,
        is_pantry: isPantryStaple(ing.name, r.pantry_items),
      })),
    )
    if (e) throw e
  }
  if (r.steps.length) {
    const { error: e } = await supabase.from('recipe_steps').insert(
      r.steps.map((s) => ({
        recipe_id: id,
        step_number: s.step_number,
        title: s.title,
        body: s.body,
        image_path: dir && s.step_number >= 1 && s.step_number <= LAYOUT.steps.length ? `${dir}/step-${s.step_number}.jpg` : null,
      })),
    )
    if (e) throw e
  }
  await supabase.rpc('recipe_refresh_search', { p_recipe_id: id })
  onPhase('done')
}

async function upload(path: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: true })
  if (error) throw error
}
