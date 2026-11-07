-- Prescriptions for MediAgenda patients (patient_id = MediAgenda's id; name, sex and birth date are copied).
CREATE TABLE prescriptions (
  id           VARCHAR(20)  PRIMARY KEY,
  patient_id   BIGINT       NOT NULL,
  fiscal_code  VARCHAR(16)  NOT NULL,
  patient_name VARCHAR(130) NOT NULL,
  sex          CHAR(1)      NOT NULL,
  birth_date   DATE         NOT NULL,
  prescriber   VARCHAR(80)  NOT NULL,
  status       VARCHAR(20)  NOT NULL,
  issued_at    TIMESTAMP    NOT NULL
);

CREATE TABLE prescription_items (
  prescription_id VARCHAR(20) NOT NULL REFERENCES prescriptions (id),
  line_no         INT         NOT NULL,
  aic             VARCHAR(9)  NOT NULL REFERENCES drugs (aic),
  dose            VARCHAR(60) NOT NULL,
  frequency       VARCHAR(60) NOT NULL,
  days            INT         NOT NULL,
  packs           INT         NOT NULL,
  PRIMARY KEY (prescription_id, line_no)
);

CREATE SEQUENCE prescription_seq START WITH 100;

INSERT INTO prescriptions (id, patient_id, fiscal_code, patient_name, sex, birth_date, prescriber, status, issued_at) VALUES
  ('RX-2026-00028', 2, 'BNCLRA85C45L219Y', 'Bianchi Laura',  'F', '1985-03-05', 'Dr.ssa Elena Sala',   'DISPENSATA', '2026-10-28 10:15:00'),
  ('RX-2026-00031', 1, 'RSSMRA80A01F205X', 'Rossi Mario',    'M', '1980-01-01', 'Dr. Marco Fumagalli', 'EMESSA',     '2026-11-04 09:40:00'),
  ('RX-2026-00033', 3, 'VRDGPP72D12H501Z', 'Verdi Giuseppe', 'M', '1972-04-12', 'Dr.ssa Elena Sala',   'EMESSA',     '2026-11-05 11:05:00'),
  ('RX-2026-00034', 5, 'RMNLCU66H20D969W', 'Romano Luca',    'M', '1966-06-20', 'Dr. Paolo Brambilla', 'ANNULLATA',  '2026-11-05 15:30:00'),
  ('RX-2026-00036', 6, 'GLLSFN78M41F839J', 'Gallo Stefania', 'F', '1978-08-01', 'Dr. Marco Fumagalli', 'EMESSA',     '2026-11-06 08:50:00');

INSERT INTO prescription_items (prescription_id, line_no, aic, dose, frequency, days, packs) VALUES
  ('RX-2026-00028', 0, '045678012', '1 compressa', '3 volte al giorno',      6,  2),
  ('RX-2026-00031', 0, '089012010', '1 compressa', 'al bisogno, max 3/die',  5,  1),
  ('RX-2026-00031', 1, '090123012', '1 compressa', '1 volta al giorno',      30, 1),
  ('RX-2026-00033', 0, '101234014', '1 compressa', 'la sera',                30, 1),
  ('RX-2026-00033', 1, '023456018', '1 compressa', 'al mattino',             30, 1),
  ('RX-2026-00034', 0, '056789014', '1 compressa', '2 volte al giorno',      7,  1),
  ('RX-2026-00036', 0, '034567010', '1 siringa',   '1 volta al giorno (sc)', 10, 1);
