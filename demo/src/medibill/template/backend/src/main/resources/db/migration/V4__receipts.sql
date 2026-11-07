-- Receipts: the open charges of a patient, the exempt part and the co-pay ("ticket", at most 36,15 € a receipt).
CREATE TABLE receipts (
  id              VARCHAR(20)  PRIMARY KEY,
  fiscal_code     VARCHAR(16)  NOT NULL,
  patient_name    VARCHAR(130) NOT NULL,
  issued_at       TIMESTAMP    NOT NULL,
  total           DECIMAL(10,2) NOT NULL,
  exempt          DECIMAL(10,2) NOT NULL,
  copay           DECIMAL(10,2) NOT NULL,
  exemption_codes VARCHAR(60),
  status          VARCHAR(20)  NOT NULL,
  paid_at         TIMESTAMP
);

CREATE SEQUENCE receipt_seq START WITH 100;

ALTER TABLE charges ADD COLUMN receipt_id VARCHAR(20);

INSERT INTO receipts (id, fiscal_code, patient_name, issued_at, total, exempt, copay, exemption_codes, status, paid_at) VALUES
  ('RC-2026-00031', 'RSSMRA80A01F205X', 'Rossi Mario',    '2026-09-07 11:00:00', 22.50, 0, 22.50, '', 'PAGATA',   '2026-09-07 11:05:00'),
  ('RC-2026-00038', 'BNCLRA85C45L219Y', 'Bianchi Laura',  '2026-10-06 12:10:00', 22.50, 0, 22.50, '', 'PAGATA',   '2026-10-06 12:12:00'),
  ('RC-2026-00039', 'BNCLRA85C45L219Y', 'Bianchi Laura',  '2026-10-06 12:00:00', 22.50, 0, 22.50, '', 'STORNATA', NULL),
  ('RC-2026-00041', 'VRDGPP72D12H501Z', 'Verdi Giuseppe', '2026-10-19 10:30:00', 15.49, 0, 15.49, '', 'EMESSA',   NULL);

UPDATE charges SET status = 'IN_RICEVUTA', receipt_id = 'RC-2026-00031' WHERE id = 1;
UPDATE charges SET status = 'IN_RICEVUTA', receipt_id = 'RC-2026-00038' WHERE id = 2;
UPDATE charges SET status = 'IN_RICEVUTA', receipt_id = 'RC-2026-00041' WHERE id = 3;
