-- The vaccine catalog: doses of the primary series, days between them, the age range, and the booster interval.
CREATE TABLE vaccines (
  code            VARCHAR(10)  PRIMARY KEY,
  name            VARCHAR(80)  NOT NULL,
  doses           INT          NOT NULL,
  interval_days   INT          NOT NULL,
  min_age_months  INT          NOT NULL,
  max_age_years   INT,
  booster_months  INT
);

INSERT INTO vaccines (code, name, doses, interval_days, min_age_months, max_age_years, booster_months) VALUES
  ('ESA', 'Esavalente (DTPa-IPV-HB-Hib)', 3, 60, 2, 6, NULL),
  ('MPRV', 'Morbillo-Parotite-Rosolia-Varicella', 2, 28, 12, NULL, NULL),
  ('HPV', 'Papillomavirus 9-valente', 2, 180, 132, 26, NULL),
  ('TDAP', 'Difterite-Tetano-Pertosse (adulti)', 1, 0, 216, NULL, 120),
  ('INFL', 'Antinfluenzale stagionale', 1, 0, 6, NULL, 12),
  ('HZV', 'Herpes zoster ricombinante', 2, 60, 600, NULL, NULL),
  ('PCV', 'Pneumococco coniugato 20-valente', 1, 0, 780, NULL, NULL);
