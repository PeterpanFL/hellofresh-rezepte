-- Migration: search while typing
-- Date: 2026-11-09
-- Description:
--   The app searched with websearch_to_tsquery, which only matches whole words, so typing "Spä" or "Spätz"
--   found nothing. recipe_search() matches every typed word as a prefix (after German stemming) and also
--   falls back to a plain substring match on the title.
--   Rollback: DROP FUNCTION public.recipe_search(text);

CREATE OR REPLACE FUNCTION public.recipe_search(p_q text)
RETURNS SETOF public.recipes
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH words AS (
    SELECT regexp_replace(x, '[^[:alnum:]]', '', 'g') AS w
    FROM regexp_split_to_table(trim(coalesce(p_q, '')), '\s+') AS x
  ),
  q AS (
    SELECT to_tsquery('german', string_agg(w || ':*', ' & ')) AS tsq
    FROM words WHERE w <> ''
  )
  SELECT r.*
  FROM public.recipes r, q
  WHERE (q.tsq IS NOT NULL AND r.search @@ q.tsq)
     OR r.title ILIKE '%' || replace(replace(replace(trim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ORDER BY ts_rank(r.search, q.tsq) DESC NULLS LAST, r.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.recipe_search(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.recipe_search(text) TO authenticated;
