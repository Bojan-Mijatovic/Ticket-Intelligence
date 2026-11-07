-- Results: the value in the catalog unit at entry time, the flag (L / N / H) and the validation (signature).
CREATE TABLE results (
  id           BIGINT        PRIMARY KEY,
  order_id     VARCHAR(20)   NOT NULL REFERENCES lab_orders (id),
  exam_code    VARCHAR(10)   NOT NULL REFERENCES exams (code),
  result_value DECIMAL(12,3),
  unit         VARCHAR(20),
  flag         CHAR(1),
  entered_at   TIMESTAMP,
  validated    BOOLEAN       NOT NULL DEFAULT FALSE,
  validated_by VARCHAR(60),
  validated_at TIMESTAMP,
  UNIQUE (order_id, exam_code)
);

CREATE SEQUENCE result_seq START WITH 1000;

INSERT INTO results (id, order_id, exam_code, result_value, unit, flag, entered_at, validated, validated_by, validated_at) VALUES
  (1,  'RL-2026-00041', 'GLU',   92,   'mg/dL',    'N', '2026-10-05 12:30:00', TRUE, 'Dr.ssa Anna Ferri', '2026-10-05 13:20:00'),
  (2,  'RL-2026-00041', 'CREA',  88,   'µmol/L',   'N', '2026-10-05 12:30:00', TRUE, 'Dr.ssa Anna Ferri', '2026-10-05 13:20:00'),
  (3,  'RL-2026-00041', 'CHOL',  214,  'mg/dL',    'H', '2026-10-05 12:30:00', TRUE, 'Dr.ssa Anna Ferri', '2026-10-05 13:20:00'),
  (4,  'RL-2026-00052', 'CREA',  221,  'µmol/L',   'H', '2026-11-03 13:10:00', TRUE, 'Dr. Carlo Riva',    '2026-11-03 14:05:00'),
  (5,  'RL-2026-00052', 'UREA',  71,   'mg/dL',    'H', '2026-11-03 13:10:00', TRUE, 'Dr. Carlo Riva',    '2026-11-03 14:05:00'),
  (6,  'RL-2026-00052', 'K',     5.3,  'mmol/L',   'H', '2026-11-03 13:10:00', TRUE, 'Dr. Carlo Riva',    '2026-11-03 14:05:00'),
  (7,  'RL-2026-00052', 'GLU',   131,  'mg/dL',    'H', '2026-11-03 13:10:00', TRUE, 'Dr. Carlo Riva',    '2026-11-03 14:05:00'),
  (8,  'RL-2026-00052', 'HBA1C', 58,   'mmol/mol', 'H', '2026-11-03 13:10:00', TRUE, 'Dr. Carlo Riva',    '2026-11-03 14:05:00'),
  (9,  'RL-2026-00055', 'HB',    12.4, 'g/dL',     'N', '2026-11-02 12:00:00', TRUE, 'Dr.ssa Anna Ferri', '2026-11-02 12:40:00'),
  (10, 'RL-2026-00055', 'GLU',   85,   'mg/dL',    'N', '2026-11-02 12:00:00', TRUE, 'Dr.ssa Anna Ferri', '2026-11-02 12:40:00'),
  (11, 'RL-2026-00055', 'TSH',   2.10, 'mUI/L',    'N', '2026-11-02 12:00:00', TRUE, 'Dr.ssa Anna Ferri', '2026-11-02 12:40:00');
