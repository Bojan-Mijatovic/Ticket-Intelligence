-- CUP_BIL-311: laboratory tests (MediLab catalog tariff codes) and the tests reported in October and on 2 November.
INSERT INTO tariffs (code, description, kind, price) VALUES
  ('90.27.1', 'Glucosio',                   'LABORATORIO', 1.13),
  ('90.16.3', 'Creatinina',                 'LABORATORIO', 1.13),
  ('90.44.1', 'Urea',                       'LABORATORIO', 1.13),
  ('90.40.4', 'Sodio',                      'LABORATORIO', 1.13),
  ('90.37.4', 'Potassio',                   'LABORATORIO', 1.13),
  ('90.09.2', 'Alanina aminotransferasi',   'LABORATORIO', 1.13),
  ('90.04.5', 'Aspartato aminotransferasi', 'LABORATORIO', 1.13),
  ('90.14.3', 'Colesterolo totale',         'LABORATORIO', 1.13),
  ('90.43.5', 'Acido urico',                'LABORATORIO', 1.13),
  ('90.42.1', 'Tireotropina (TSH)',         'LABORATORIO', 13.52),
  ('90.62.2', 'Emocromo: emoglobina',       'LABORATORIO', 3.17),
  ('90.28.1', 'Emoglobina glicata (HbA1c)', 'LABORATORIO', 9.60);

INSERT INTO charges (id, source, source_ref, service_date, fiscal_code, patient_name, tariff_code, description, amount, status) VALUES
  (4,  'LABORATORIO', 'RL-2026-00041/GLU',  '2026-10-05', 'RSSMRA80A01F205X', 'Rossi Mario',   '90.27.1', 'Glucosio',             1.13,  'APERTO'),
  (5,  'LABORATORIO', 'RL-2026-00041/CREA', '2026-10-05', 'RSSMRA80A01F205X', 'Rossi Mario',   '90.16.3', 'Creatinina',           1.13,  'APERTO'),
  (6,  'LABORATORIO', 'RL-2026-00041/CHOL', '2026-10-05', 'RSSMRA80A01F205X', 'Rossi Mario',   '90.14.3', 'Colesterolo totale',   1.13,  'APERTO'),
  (7,  'LABORATORIO', 'RL-2026-00055/HB',   '2026-11-02', 'BNCLRA85C45L219Y', 'Bianchi Laura', '90.62.2', 'Emocromo: emoglobina', 3.17,  'APERTO'),
  (8,  'LABORATORIO', 'RL-2026-00055/GLU',  '2026-11-02', 'BNCLRA85C45L219Y', 'Bianchi Laura', '90.27.1', 'Glucosio',             1.13,  'APERTO'),
  (9,  'LABORATORIO', 'RL-2026-00055/TSH',  '2026-11-02', 'BNCLRA85C45L219Y', 'Bianchi Laura', '90.42.1', 'Tireotropina (TSH)',   13.52, 'APERTO');
