DELETE FROM organization_candidates
WHERE candidate_type='research'
  AND lower(name) NOT LIKE '%university%'
  AND lower(name) NOT LIKE '%universities%'
  AND lower(name) NOT LIKE '%institute%'
  AND lower(name) NOT LIKE '%laborator%'
  AND lower(name) NOT LIKE '%centre%'
  AND lower(name) NOT LIKE '%center%'
  AND lower(name) NOT LIKE '%catapult%'
  AND lower(name) NOT LIKE '%academy%'
  AND lower(name) NOT LIKE '%observator%'
  AND lower(name) NOT LIKE '%research organisation%'
  AND lower(name) NOT LIKE '%research organization%'
  AND lower(name) NOT LIKE '%research council%'
  AND name NOT LIKE '%大学%'
  AND name NOT LIKE '%学院%'
  AND name NOT LIKE '%研究院%'
  AND name NOT LIKE '%研究所%'
  AND name NOT LIKE '%实验室%'
  AND name NOT LIKE '%科学院%'
  AND name NOT LIKE '%研究中心%'
  AND name NOT LIKE '%工程中心%';
--> statement-breakpoint
PRAGMA optimize;
