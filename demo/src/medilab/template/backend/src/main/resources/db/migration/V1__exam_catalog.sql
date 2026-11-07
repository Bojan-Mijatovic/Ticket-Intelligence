-- Test catalog ("catalogo esami"): sample type, unit, reference ranges by sex, regional tariff code and price.
CREATE TABLE exams (
  code        VARCHAR(10)   PRIMARY KEY,
  name        VARCHAR(80)   NOT NULL,
  sample_type VARCHAR(20)   NOT NULL,
  unit        VARCHAR(20)   NOT NULL,
  decimals    INT           NOT NULL,
  ref_min_m   DECIMAL(10,3),
  ref_max_m   DECIMAL(10,3),
  ref_min_f   DECIMAL(10,3),
  ref_max_f   DECIMAL(10,3),
  tariff_code VARCHAR(12)   NOT NULL,
  price       DECIMAL(8,2)  NOT NULL,
  active      BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO exams (code, name, sample_type, unit, decimals, ref_min_m, ref_max_m, ref_min_f, ref_max_f, tariff_code, price) VALUES
  ('GLU',   'Glucosio',            'SIERO',  'mg/dL',    0,  70,    99,    70,    99,    '90.27.1', 1.13),
  ('CREA',  'Creatinina',          'SIERO',  'µmol/L',   0,  62,    106,   44,    80,    '90.16.3', 1.13),
  ('UREA',  'Urea (azotemia)',     'SIERO',  'mg/dL',    0,  17,    49,    17,    49,    '90.44.1', 1.13),
  ('NA',    'Sodio',               'SIERO',  'mmol/L',   0,  136,   145,   136,   145,   '90.40.4', 1.13),
  ('K',     'Potassio',            'SIERO',  'mmol/L',   1,  3.5,   5.1,   3.5,   5.1,   '90.37.4', 1.13),
  ('ALT',   'ALT (GPT)',           'SIERO',  'U/L',      0,  0,     41,    0,     33,    '90.09.2', 1.13),
  ('AST',   'AST (GOT)',           'SIERO',  'U/L',      0,  0,     40,    0,     32,    '90.04.5', 1.13),
  ('CHOL',  'Colesterolo totale',  'SIERO',  'mg/dL',    0,  NULL,  200,   NULL,  200,   '90.14.3', 1.13),
  ('URIC',  'Acido urico',         'SIERO',  'mg/dL',    1,  3.4,   7.0,   2.4,   5.7,   '90.43.5', 1.13),
  ('TSH',   'TSH',                 'SIERO',  'mUI/L',    2,  0.27,  4.20,  0.27,  4.20,  '90.42.1', 13.52),
  ('HB',    'Emoglobina',          'SANGUE', 'g/dL',     1,  13.5,  17.5,  12.0,  15.5,  '90.62.2', 3.17),
  ('HBA1C', 'Emoglobina glicata',  'SANGUE', 'mmol/mol', 0,  20,    42,    20,    42,    '90.28.1', 9.60);
