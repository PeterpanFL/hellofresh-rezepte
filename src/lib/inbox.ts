import { BUCKET, supabase } from './supabase'
import { DuplicateFileError, ExtractionError, importRecipePdf, type ImportPhase } from './importRecipe'

/**
 * Scans that the Mac uploader (scripts/mac) put into <user_id>/inbox/. The web app turns them into recipes,
 * because cutting out the images happens in the browser.
 */
export async function listInbox(): Promise<string[]> {
  const { data: auth } = await supabase.auth.getUser()
  const uid = auth.user?.id
  if (!uid) return []
  const { data, error } = await supabase.storage.from(BUCKET).list(`${uid}/inbox`, { limit: 1000, sortBy: { column: 'name', order: 'asc' } })
  if (error) throw error
  return (data ?? []).filter((f) => f.name.toLowerCase().endsWith('.pdf')).map((f) => `${uid}/inbox/${f.name}`)
}

export function inboxDisplayName(path: string) {
  return path.split('/').pop()!.replace(/^\d{8}-\d{6}-/, '')
}

/** Imports one inbox file. It is removed from the inbox once a recipe exists for it (or it was a duplicate). */
export async function importFromInbox(path: string, onPhase: (p: ImportPhase) => void): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) throw error
  const file = new File([data], inboxDisplayName(path), { type: 'application/pdf' })
  try {
    const id = await importRecipePdf(file, onPhase)
    await supabase.storage.from(BUCKET).remove([path])
    return id
  } catch (e) {
    if (e instanceof DuplicateFileError || e instanceof ExtractionError) await supabase.storage.from(BUCKET).remove([path])
    throw e
  }
}
