ALTER TABLE boundaries
  MODIFY level ENUM('land','regbez','kreis','gemeinde','plz2','plz5') NOT NULL,
  DROP COLUMN parent_codes,
  ADD COLUMN regbez CHAR(3) NULL AFTER name,
  ADD COLUMN kreis CHAR(5) NULL AFTER regbez,
  ADD KEY ix_boundaries_regbez (regbez),
  ADD KEY ix_boundaries_kreis (kreis);
ALTER TABLE facilities MODIFY regbez CHAR(3) NULL;
CREATE TABLE boundary_imports (
  level ENUM('land','regbez','kreis','gemeinde','plz2','plz5') NOT NULL PRIMARY KEY,
  source VARCHAR(255) NOT NULL,
  license VARCHAR(120) NOT NULL,
  attribution VARCHAR(255) NOT NULL,
  feature_count INT UNSIGNED NOT NULL,
  imported_at DATETIME NOT NULL DEFAULT UTC_TIMESTAMP()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
