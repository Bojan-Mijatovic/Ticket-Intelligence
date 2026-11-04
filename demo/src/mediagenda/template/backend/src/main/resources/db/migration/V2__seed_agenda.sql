-- Demo data (fictional).

INSERT INTO structures (id, name, city) VALUES
  ('SVIL_MS_VISITE', 'Poliambulatorio Visite Specialistiche', 'Milano'),
  ('TEST_GEN_25',    'Centro Diagnostico Generale 25',        'Bergamo'),
  ('UP18491',        'Presidio Ospedaliero Lodi',             'Lodi'),
  ('CA_PRESIDIO',    'Presidio Ospedaliero Casale',           'Casale');

INSERT INTO resources (code, description, structure_id, active) VALUES
  ('MS_DERMATOLOGIA', 'DERMATOLOGIA MILANO',     'SVIL_MS_VISITE', TRUE),
  ('MS_ORTOPEDIA',    'ORTOPEDIA MILANO',        'SVIL_MS_VISITE', TRUE),
  ('MS_ALLERGOLOGIA', 'ALLERGOLOGIA MILANO',     'SVIL_MS_VISITE', FALSE),
  ('TG_RADIOLOGIA',   'RADIOLOGIA BERGAMO',      'TEST_GEN_25',    TRUE),
  ('TG_LABORATORIO',  'LABORATORIO ANALISI',     'TEST_GEN_25',    TRUE),
  ('LO_OCULISTICA',   'OCULISTICA LODI',         'UP18491',        TRUE),
  ('CA_CARDIOLOGIA',  'CARDIOLOGIA CASALE',      'CA_PRESIDIO',    TRUE);

INSERT INTO time_slots (id, agenda_name, slot_code, start_date, end_date, frequency, weekday, start_time, end_time, priority, priority_rank, calendar_end_date, resource_code, structure_id) VALUES
  (143201, 'AMBULATORIO DI DERMATOLOGIA', '541200|0900|1200', '2026-01-01', '2030-12-31', '09:00-12:00, ogni lunedì',    'lunedì',    '09:00', '12:00', 'P - PROGRAMMATO', 5, '2030-12-30', 'MS_DERMATOLOGIA', 'SVIL_MS_VISITE'),
  (143202, 'AMBULATORIO DI DERMATOLOGIA', '541200|1400|1700', '2026-01-01', '2030-12-31', '14:00-17:00, ogni giovedì',   'giovedì',   '14:00', '17:00', 'P - PROGRAMMATO', 5, '2030-12-26', 'MS_DERMATOLOGIA', 'SVIL_MS_VISITE'),
  (143210, 'AMBULATORIO DI ORTOPEDIA',    '541310|0830|1230', '2026-03-01', '2030-12-31', '08:30-12:30, ogni martedì',   'martedì',   '08:30', '12:30', 'B - BREVE',       3, '2030-12-31', 'MS_ORTOPEDIA',    'SVIL_MS_VISITE'),
  (143211, 'AMBULATORIO DI ORTOPEDIA',    '541310|1400|1600', '2026-03-01', '2030-12-31', '14:00-16:00, ogni venerdì',   'venerdì',   '14:00', '16:00', 'D - DIFFERITA',   4, '2030-12-27', 'MS_ORTOPEDIA',    'SVIL_MS_VISITE'),
  (144501, 'RADIOLOGIA TRADIZIONALE',     '552010|0800|1300', '2026-01-01', '2030-12-31', '08:00-13:00, ogni lunedì',    'lunedì',    '08:00', '13:00', 'U - URGENTE',     1, '2030-12-30', 'TG_RADIOLOGIA',   'TEST_GEN_25'),
  (144502, 'RADIOLOGIA TRADIZIONALE',     '552010|1400|1800', '2026-01-01', '2030-12-31', '14:00-18:00, ogni mercoledì', 'mercoledì', '14:00', '18:00', 'P - PROGRAMMATO', 5, '2030-12-25', 'TG_RADIOLOGIA',   'TEST_GEN_25'),
  (144520, 'PRELIEVI',                    '552300|0730|1000', '2026-01-01', '2030-12-31', '07:30-10:00, ogni giorno',    'lunedì',    '07:30', '10:00', 'P - PROGRAMMATO', 5, '2030-12-30', 'TG_LABORATORIO',  'TEST_GEN_25'),
  (146524, 'CAMPO PACHIM - AMBULATORIO OCULISTICO DI REPARTO', '536135|0900|1130', '2026-01-01', '2030-12-31', '09:00-11:30, ogni mercoledì', 'mercoledì', '09:00', '11:30', 'P - PROGRAMMATO', 5, '2030-12-18', 'LO_OCULISTICA', 'UP18491'),
  (146525, 'CAMPO PACHIM - AMBULATORIO OCULISTICO DI REPARTO', '536135|0900|1130', '2026-01-01', '2030-12-31', '09:00-11:30, ogni venerdì',   'venerdì',   '09:00', '11:30', 'P - PROGRAMMATO', 5, '2030-12-27', 'LO_OCULISTICA', 'UP18491'),
  (143278, 'AMBULATORIO DI CARDIOLOGIA',  '567455|1330|1630', '2026-07-01', '2030-12-31', '13:30-16:30, ogni martedì',   'martedì',   '13:30', '16:30', 'P - PROGRAMMATO', 5, '2030-12-31', 'CA_CARDIOLOGIA',  'CA_PRESIDIO');
