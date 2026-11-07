-- Co-pay exemptions of patients (fiscal code and name as in the MediAgenda registry).
CREATE TABLE exemptions (
  id              BIGINT       PRIMARY KEY,
  fiscal_code     VARCHAR(16)  NOT NULL,
  patient_name    VARCHAR(130) NOT NULL,
  code            VARCHAR(5)   NOT NULL,
  description     VARCHAR(120) NOT NULL,
  total_exemption BOOLEAN      NOT NULL,
  tariff_codes    VARCHAR(200),
  valid_from      DATE         NOT NULL,
  valid_to        DATE         NOT NULL
);

CREATE SEQUENCE exemption_seq START WITH 100;

INSERT INTO exemptions (id, fiscal_code, patient_name, code, description, total_exemption, tariff_codes, valid_from, valid_to) VALUES
  (1, 'MRNPLA61S03C351V', 'Marino Paolo',  '013', 'Diabete mellito',                                        FALSE, '90.27.1,90.28.1,95.02', '2024-01-01', '2027-12-31'),
  (2, 'RMNLCU66H20D969W', 'Romano Luca',   '048', 'Patologia neoplastica maligna',                          TRUE,  '',                      '2025-09-01', '2026-12-31'),
  (3, 'BNCLRA85C45L219Y', 'Bianchi Laura', 'E02', 'Disoccupato e familiari a carico, reddito ≤ 8.263,31 €', TRUE,  '',                      '2025-07-01', '2026-06-30');
