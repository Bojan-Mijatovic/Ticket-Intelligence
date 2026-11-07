-- What the pharmacy handed out: lots and packs per prescription.
CREATE TABLE dispensings (
  id              BIGINT      PRIMARY KEY,
  prescription_id VARCHAR(20) NOT NULL REFERENCES prescriptions (id),
  dispensed_at    TIMESTAMP   NOT NULL
);

CREATE TABLE dispensing_lines (
  dispensing_id BIGINT      NOT NULL REFERENCES dispensings (id),
  line_no       INT         NOT NULL,
  aic           VARCHAR(9)  NOT NULL REFERENCES drugs (aic),
  lot_number    VARCHAR(20) NOT NULL,
  packs         INT         NOT NULL,
  PRIMARY KEY (dispensing_id, line_no)
);

CREATE SEQUENCE dispensing_seq START WITH 100;

-- RX-2026-00028 was handed out from L-AM2605 (5 packs then, 3 left: lots.quantity is the stock after it).
INSERT INTO dispensings (id, prescription_id, dispensed_at) VALUES (1, 'RX-2026-00028', '2026-10-28 11:00:00');
INSERT INTO dispensing_lines (dispensing_id, line_no, aic, lot_number, packs) VALUES (1, 0, '045678012', 'L-AM2605', 2);
