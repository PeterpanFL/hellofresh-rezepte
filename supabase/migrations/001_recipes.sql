-- Migration: HelloFresh-Rezepte (recipes, recipe_ingredients, recipe_steps, recipe_pantry)
-- Date: 2026-11-09
-- Description:
--   Stores scanned HelloFresh recipe cards. Every row belongs to one user (RLS).
--   Images live in the private bucket `recipe-scans` under <user_id>/<recipe_id>/...
--   All names are prefixed with recipe_ so the schema can share a Supabase project
--   with other apps.
--   Duplicates: an identical PDF (SHA-256) is rejected; a different scan with the same title gets duplicate_of.
--   Rollback: DROP FUNCTION recipe_match; DROP TABLE recipe_pantry, recipe_steps,
--   recipe_ingredients, recipes; delete the bucket recipe-scans.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Recipes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recipes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  card_number      integer,                       -- the number in the orange box (e.g. 52)
  title            text NOT NULL DEFAULT 'Neues Rezept',
  subtitle         text,
  tags             text[] NOT NULL DEFAULT '{}',  -- e.g. {Extra schnell, Vegetarisch}
  minutes_min      integer CHECK (minutes_min IS NULL OR minutes_min >= 0),
  minutes_max      integer CHECK (minutes_max IS NULL OR minutes_max >= 0),
  kcal             integer CHECK (kcal IS NULL OR kcal >= 0),
  pantry_note      text,                          -- "Basiszutaten aus Deiner Küche" as printed
  nutrition        jsonb NOT NULL DEFAULT '[]',   -- [{name, per_100g, per_portion}]
  allergens        text,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'extracted', 'checked', 'failed')),
  extraction_error text,
  pdf_path         text,
  front_path       text,
  back_path        text,
  hero_path        text,
  ingredients_path text,
  pdf_sha256       text,                          -- same file uploaded twice is rejected
  duplicate_of     uuid REFERENCES public.recipes(id) ON DELETE SET NULL, -- same title as an older card
  search           tsvector,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipes_user_idx ON public.recipes (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS recipes_search_idx ON public.recipes USING gin (search);
CREATE UNIQUE INDEX IF NOT EXISTS recipes_user_pdf_sha256_idx ON public.recipes (user_id, pdf_sha256) WHERE pdf_sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS recipes_user_title_idx ON public.recipes (user_id, lower(title));
CREATE INDEX IF NOT EXISTS recipes_duplicate_of_idx ON public.recipes (duplicate_of) WHERE duplicate_of IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Ingredients per recipe (amounts for 2, 3 and 4 persons as printed)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recipe_ingredients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id      uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  position       integer NOT NULL DEFAULT 0,
  original_name  text NOT NULL,                 -- "frische Eierspätzle 8) 13) 15)"
  name           text NOT NULL,                 -- normalised: "Spätzle"
  amount_2p      text,                          -- kept as text: "187,5 g**", "2", "50 ml"
  amount_3p      text,
  amount_4p      text,
  is_pantry      boolean NOT NULL DEFAULT false -- Basiszutat (Salz, Öl, Butter ...)
);

CREATE INDEX IF NOT EXISTS recipe_ingredients_recipe_idx ON public.recipe_ingredients (recipe_id, position);
CREATE INDEX IF NOT EXISTS recipe_ingredients_user_name_idx ON public.recipe_ingredients (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- 3. Steps
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recipe_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id   uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  step_number integer NOT NULL CHECK (step_number > 0),
  title       text,
  body        text,
  image_path  text,
  UNIQUE (recipe_id, step_number)
);

-- ---------------------------------------------------------------------------
-- 4. Pantry: what the user has at home (normalised names)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.recipe_pantry (
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);

-- ---------------------------------------------------------------------------
-- 5. Row level security: every user sees only their own rows
-- ---------------------------------------------------------------------------

ALTER TABLE public.recipes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_steps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_pantry      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recipes_own ON public.recipes;
CREATE POLICY recipes_own ON public.recipes FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS recipe_ingredients_own ON public.recipe_ingredients;
CREATE POLICY recipe_ingredients_own ON public.recipe_ingredients FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_id AND r.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS recipe_steps_own ON public.recipe_steps;
CREATE POLICY recipe_steps_own ON public.recipe_steps FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_id AND r.user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS recipe_pantry_own ON public.recipe_pantry;
CREATE POLICY recipe_pantry_own ON public.recipe_pantry FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. Full-text search vector (title, subtitle, tags, ingredients, steps)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recipe_refresh_search(p_recipe_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.recipes r
  SET search =
        setweight(to_tsvector('german', coalesce(r.title, '') || ' ' || coalesce(r.subtitle, '')), 'A')
     || setweight(to_tsvector('german', array_to_string(r.tags, ' ')), 'B')
     || setweight(to_tsvector('german', coalesce((
          SELECT string_agg(i.name || ' ' || i.original_name, ' ')
          FROM public.recipe_ingredients i WHERE i.recipe_id = r.id), '')), 'B')
     || setweight(to_tsvector('german', coalesce((
          SELECT string_agg(coalesce(s.title, '') || ' ' || coalesce(s.body, ''), ' ')
          FROM public.recipe_steps s WHERE s.recipe_id = r.id), '')), 'C'),
      updated_at = now()
  WHERE r.id = p_recipe_id;
$$;

-- ---------------------------------------------------------------------------
-- 7. Ingredient match: rank recipes by how few ingredients are missing.
--    Pantry staples (is_pantry) never count as missing. Matching is
--    case-insensitive and also accepts a pantry word inside the name
--    ("Tomaten" matches "Kirschtomaten").
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.recipe_match(p_have text[])
RETURNS TABLE (
  recipe_id     uuid,
  total         integer,
  have_count    integer,
  missing_count integer,
  missing       text[]
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH have AS (
    SELECT DISTINCT lower(trim(h)) AS h FROM unnest(p_have) AS h WHERE trim(h) <> ''
  ),
  ing AS (
    SELECT i.recipe_id, i.name,
           EXISTS (
             SELECT 1 FROM have
             WHERE lower(i.name) = have.h
                OR (length(have.h) >= 4 AND position(have.h IN lower(i.name)) > 0)
           ) AS ok
    FROM public.recipe_ingredients i
    WHERE NOT i.is_pantry
  )
  SELECT ing.recipe_id,
         count(*)::int                                   AS total,
         count(*) FILTER (WHERE ing.ok)::int             AS have_count,
         count(*) FILTER (WHERE NOT ing.ok)::int         AS missing_count,
         coalesce(array_agg(ing.name ORDER BY ing.name) FILTER (WHERE NOT ing.ok), '{}') AS missing
  FROM ing
  GROUP BY ing.recipe_id
  HAVING count(*) FILTER (WHERE ing.ok) > 0
  ORDER BY missing_count, have_count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.recipe_match(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recipe_refresh_search(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.recipe_match(text[]) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.recipe_refresh_search(uuid) FROM anon, public;

-- ---------------------------------------------------------------------------
-- 8. Storage: private bucket, each user only under their own folder
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recipe-scans', 'recipe-scans', false, 20971520, ARRAY['application/pdf', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS recipe_scans_own ON storage.objects;
CREATE POLICY recipe_scans_own ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'recipe-scans' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'recipe-scans' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

COMMIT;
