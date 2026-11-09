import { useQuery } from '@tanstack/react-query'
import { BUCKET, supabase } from './supabase'
import type { MatchRow, Recipe, RecipeIngredient, RecipeStep } from './types'

export const keys = {
  recipes: (q: string) => ['recipes', q] as const,
  recipe: (id: string) => ['recipe', id] as const,
  ingredientNames: ['ingredient-names'] as const,
  pantry: ['pantry'] as const,
  match: (have: string[]) => ['match', have] as const,
}

export function useRecipes(search: string) {
  return useQuery({
    queryKey: keys.recipes(search),
    queryFn: async () => {
      // recipe_search matches every typed word as a prefix, so results appear while typing.
      const { data, error } = search.trim()
        ? await supabase.rpc('recipe_search', { p_q: search.trim() })
        : await supabase.from('recipes').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Recipe[]
    },
  })
}

export function useRecipe(id: string) {
  return useQuery({
    queryKey: keys.recipe(id),
    queryFn: async () => {
      const [r, i, s] = await Promise.all([
        supabase.from('recipes').select('*').eq('id', id).single(),
        supabase.from('recipe_ingredients').select('*').eq('recipe_id', id).order('position'),
        supabase.from('recipe_steps').select('*').eq('recipe_id', id).order('step_number'),
      ])
      if (r.error) throw r.error
      if (i.error) throw i.error
      if (s.error) throw s.error
      return { recipe: r.data as Recipe, ingredients: i.data as RecipeIngredient[], steps: s.data as RecipeStep[] }
    },
  })
}

/** All normalised ingredient names across the user's recipes, for suggestions. */
export function useIngredientNames() {
  return useQuery({
    queryKey: keys.ingredientNames,
    queryFn: async () => {
      const { data, error } = await supabase.from('recipe_ingredients').select('name').eq('is_pantry', false)
      if (error) throw error
      const counts = new Map<string, number>()
      for (const { name } of data as { name: string }[]) counts.set(name, (counts.get(name) ?? 0) + 1)
      return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de')).map(([n]) => n)
    },
  })
}

export function usePantry() {
  return useQuery({
    queryKey: keys.pantry,
    queryFn: async () => {
      const { data, error } = await supabase.from('recipe_pantry').select('name').order('name')
      if (error) throw error
      return (data as { name: string }[]).map((r) => r.name)
    },
  })
}

export function useMatch(have: string[]) {
  return useQuery({
    queryKey: keys.match(have),
    enabled: have.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('recipe_match', { p_have: have })
      if (error) throw error
      return data as MatchRow[]
    },
  })
}

/** Short-lived signed URLs for private images, one request for many paths. */
export function useSignedUrls(paths: (string | null | undefined)[]) {
  const list = [...new Set(paths.filter((p): p is string => Boolean(p)))].sort()
  return useQuery({
    queryKey: ['signed', list],
    enabled: list.length > 0,
    staleTime: 50 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(list, 60 * 60)
      if (error) throw error
      const map: Record<string, string> = {}
      for (const row of data) if (row.path && row.signedUrl) map[row.path] = row.signedUrl
      return map
    },
  })
}
