-- Lagemodus mit Szenario: Szenarien können „flächig“ wirken (betrifft alle Einrichtungen im Gebiet, z. B. Stromausfall),
-- sonst zählen nur Einrichtungen, die für das Szenario als gefährdet markiert sind. Ereignisse merken sich ihr Szenario.
ALTER TABLE scenarios ADD COLUMN area_wide TINYINT(1) NOT NULL DEFAULT 0 AFTER symbol;
UPDATE scenarios SET area_wide = 1 WHERE name IN ('Langanhaltender Stromausfall', 'Cyberangriff');
ALTER TABLE events ADD COLUMN scenario_id INT UNSIGNED NULL AFTER name;
