-- Test requests for MediAgenda patients (patient_id = MediAgenda's id; name, sex and birth date are copied).
CREATE TABLE lab_orders (
  id                VARCHAR(20)  PRIMARY KEY,
  patient_id        BIGINT       NOT NULL,
  fiscal_code       VARCHAR(16)  NOT NULL,
  patient_name      VARCHAR(130) NOT NULL,
  sex               CHAR(1)      NOT NULL,
  birth_date        DATE         NOT NULL,
  prescriber        VARCHAR(80)  NOT NULL,
  prescription_code VARCHAR(15),
  urgent            BOOLEAN      NOT NULL DEFAULT FALSE,
  status            VARCHAR(20)  NOT NULL,
  requested_at      TIMESTAMP    NOT NULL,
  reported_at       TIMESTAMP,
  cancel_reason     VARCHAR(200)
);

CREATE TABLE order_items (
  order_id  VARCHAR(20) NOT NULL REFERENCES lab_orders (id),
  exam_code VARCHAR(10) NOT NULL REFERENCES exams (code),
  PRIMARY KEY (order_id, exam_code)
);

CREATE SEQUENCE order_seq START WITH 100;

-- Fictional requests (the patients are those of the MediAgenda seed).
INSERT INTO lab_orders (id, patient_id, fiscal_code, patient_name, sex, birth_date, prescriber, prescription_code, urgent, status, requested_at, reported_at, cancel_reason) VALUES
  ('RL-2026-00041', 1, 'RSSMRA80A01F205X', 'Rossi Mario',      'M', '1980-01-01', 'Dr. Marco Fumagalli', '0301A4000556677', FALSE, 'REFERTATA',      '2026-10-05 08:10:00', '2026-10-05 13:20:00', NULL),
  ('RL-2026-00047', 7, 'CSTNDR93P10L736Q', 'Costa Andrea',     'M', '1993-09-10', 'Dr.ssa Elena Sala',   NULL,              FALSE, 'ANNULLATA',      '2026-10-20 09:00:00', NULL,                  'Richiesta duplicata'),
  ('RL-2026-00052', 9, 'MRNPLA61S03C351V', 'Marino Paolo',     'M', '1961-11-03', 'Dr. Paolo Brambilla', '0301A4000771122', FALSE, 'REFERTATA',      '2026-11-03 08:30:00', '2026-11-03 14:05:00', NULL),
  ('RL-2026-00055', 2, 'BNCLRA85C45L219Y', 'Bianchi Laura',    'F', '1985-03-05', 'Dr.ssa Elena Sala',   NULL,              FALSE, 'REFERTATA',      '2026-11-02 07:50:00', '2026-11-02 12:40:00', NULL),
  ('RL-2026-00058', 4, 'FRRGLI90E50A794K', 'Ferrari Giulia',   'F', '1990-05-10', 'Dr. Marco Fumagalli', '0301A4000993344', FALSE, 'IN_LAVORAZIONE', '2026-11-05 08:15:00', NULL,                  NULL),
  ('RL-2026-00060', 5, 'RMNLCU66H20D969W', 'Romano Luca',      'M', '1966-06-20', 'Dr. Paolo Brambilla', NULL,              TRUE,  'IN_LAVORAZIONE', '2026-11-06 07:40:00', NULL,                  NULL),
  ('RL-2026-00061', 3, 'VRDGPP72D12H501Z', 'Verdi Giuseppe',   'M', '1972-04-12', 'Dr.ssa Elena Sala',   '0301A4000118899', FALSE, 'RICHIESTA',      '2026-11-06 09:20:00', NULL,                  NULL),
  ('RL-2026-00062', 6, 'GLLSFN78M41F839J', 'Gallo Stefania',   'F', '1978-08-01', 'Dr. Marco Fumagalli', NULL,              FALSE, 'RICHIESTA',      '2026-11-07 08:05:00', NULL,                  NULL);

INSERT INTO order_items (order_id, exam_code) VALUES
  ('RL-2026-00041', 'GLU'), ('RL-2026-00041', 'CREA'), ('RL-2026-00041', 'CHOL'),
  ('RL-2026-00047', 'GLU'),
  ('RL-2026-00052', 'CREA'), ('RL-2026-00052', 'UREA'), ('RL-2026-00052', 'K'), ('RL-2026-00052', 'GLU'), ('RL-2026-00052', 'HBA1C'),
  ('RL-2026-00055', 'HB'), ('RL-2026-00055', 'GLU'), ('RL-2026-00055', 'TSH'),
  ('RL-2026-00058', 'GLU'), ('RL-2026-00058', 'CREA'), ('RL-2026-00058', 'ALT'), ('RL-2026-00058', 'AST'),
  ('RL-2026-00060', 'K'), ('RL-2026-00060', 'NA'), ('RL-2026-00060', 'CREA'), ('RL-2026-00060', 'HB'),
  ('RL-2026-00061', 'CHOL'), ('RL-2026-00061', 'GLU'), ('RL-2026-00061', 'URIC'),
  ('RL-2026-00062', 'HB'), ('RL-2026-00062', 'HBA1C'), ('RL-2026-00062', 'GLU');
