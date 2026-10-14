ALTER TABLE users
  ADD COLUMN display_name VARCHAR(120) NULL AFTER username,
  ADD COLUMN last_login_at DATETIME NULL AFTER active
