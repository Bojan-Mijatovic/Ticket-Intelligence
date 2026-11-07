-- Services to charge, imported each day from MediAgenda (visits); source_ref is the booking id.
CREATE TABLE charges (
  id           BIGINT       PRIMARY KEY,
  source       VARCHAR(20)  NOT NULL,
  source_ref   VARCHAR(40)  NOT NULL,
  service_date DATE         NOT NULL,
  fiscal_code  VARCHAR(16)  NOT NULL,
  patient_name VARCHAR(130) NOT NULL,
  tariff_code  VARCHAR(12)  NOT NULL REFERENCES tariffs (code),
  description  VARCHAR(120) NOT NULL,
  amount       DECIMAL(8,2) NOT NULL,
  status       VARCHAR(20)  NOT NULL
);

CREATE SEQUENCE charge_seq START WITH 1000;

-- The completed MediAgenda visits of September and October (PR-2026-00412, 00498, 00533).
INSERT INTO charges (id, source, source_ref, service_date, fiscal_code, patient_name, tariff_code, description, amount, status) VALUES
  (1, 'VISITA', 'PR-2026-00412', '2026-09-07', 'RSSMRA80A01F205X', 'Rossi Mario',    '89.7A.7', 'Prima visita dermatologica', 22.50, 'APERTO'),
  (2, 'VISITA', 'PR-2026-00498', '2026-10-06', 'BNCLRA85C45L219Y', 'Bianchi Laura',  '89.7B.7', 'Prima visita ortopedica',    22.50, 'APERTO'),
  (3, 'VISITA', 'PR-2026-00533', '2026-10-19', 'VRDGPP72D12H501Z', 'Verdi Giuseppe', '87.44.1', 'Radiografia del torace',     15.49, 'APERTO');
