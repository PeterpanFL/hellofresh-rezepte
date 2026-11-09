export type RecipeStatus = 'new' | 'extracted' | 'checked' | 'failed'

export interface Recipe {
  id: string
  card_number: number | null
  title: string
  subtitle: string | null
  tags: string[]
  minutes_min: number | null
  minutes_max: number | null
  kcal: number | null
  pantry_note: string | null
  nutrition: { name: string; per_100g: string | null; per_portion: string | null }[]
  allergens: string | null
  status: RecipeStatus
  extraction_error: string | null
  pdf_path: string | null
  front_path: string | null
  back_path: string | null
  hero_path: string | null
  ingredients_path: string | null
  pdf_sha256: string | null
  duplicate_of: string | null
  created_at: string
}

export interface RecipeIngredient {
  id: string
  recipe_id: string
  position: number
  original_name: string
  name: string
  amount_2p: string | null
  amount_3p: string | null
  amount_4p: string | null
  is_pantry: boolean
}

export interface RecipeStep {
  id: string
  recipe_id: string
  step_number: number
  title: string | null
  body: string | null
  image_path: string | null
}

export interface MatchRow {
  recipe_id: string
  total: number
  have_count: number
  missing_count: number
  missing: string[]
}

/** What the recipe-ocr Edge Function returns. */
export interface ExtractedRecipe {
  card_number: number | null
  title: string
  subtitle: string | null
  tags: string[]
  minutes_min: number | null
  minutes_max: number | null
  kcal: number | null
  pantry_items: string[]
  ingredients: { original_name: string; name: string; amount_2p: string | null; amount_3p: string | null; amount_4p: string | null }[]
  steps: { step_number: number; title: string; body: string }[]
  nutrition: { name: string; per_100g: string | null; per_portion: string | null }[]
  allergens: string | null
}
