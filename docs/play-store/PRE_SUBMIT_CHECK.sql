-- Play'ga yuborishdan oldin PRODUCTION bazada tekshirish (faqat o'qiydi, hech narsa o'zgartirmaydi).
-- Serverda:  docker exec -i ds-prod-db-1 sh -c 'psql -U "$POSTGRES_USER" -d ds_prod' < docs/play-store/PRE_SUBMIT_CHECK.sql

-- 1) Restoranlar: faol, ish vaqti (NULL = cheklov yo'q), nechta taom, nechtasida rasm bor.
SELECT r.slug, r."isActive", r."workingHours"::text AS working_hours,
       count(p.*) FILTER (WHERE p."archivedAt" IS NULL AND p."isAvailable") AS dishes_available,
       count(p.*) FILTER (WHERE p."archivedAt" IS NULL AND p."isAvailable" AND (p."imageUrl" IS NOT NULL OR pi."productId" IS NOT NULL)) AS with_photo
FROM "Restaurant" r
LEFT JOIN "Product" p ON p."restaurantId" = r.id
LEFT JOIN "ProductImage" pi ON pi."productId" = p.id
GROUP BY r.id ORDER BY r.slug;

-- 2) Spirtli ichimlikka o'xshash nomlar (ro'yxat BO'SH bo'lishi kerak; chiqsa restoran bilan gaplashib olib tashlang).
SELECT r.slug, p.name, p."isAvailable", p."archivedAt"
FROM "Product" p JOIN "Restaurant" r ON r.id = p."restaurantId"
WHERE p."archivedAt" IS NULL
  AND p.name ~* '(pivo|vino|vodka|aroq|konyak|konyaq|viski|whisk|коньяк|водка|пиво|вино|виски|шампан|шампан|ликер|ром\M|beer|wine|brandy|liqueur|shampan|sharob|alkogol)';
