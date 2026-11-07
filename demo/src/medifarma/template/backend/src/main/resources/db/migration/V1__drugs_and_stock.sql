-- Hospital formulary (AIC = Italian marketing authorisation code, fictional here) and the pharmacy stock by lot.
CREATE TABLE drugs (
  aic               VARCHAR(9)    PRIMARY KEY,
  name              VARCHAR(80)   NOT NULL,
  active_ingredient VARCHAR(60)   NOT NULL,
  atc               VARCHAR(7)    NOT NULL,
  pack_size         INT           NOT NULL,
  unit_price        DECIMAL(8,2)  NOT NULL,
  min_stock         INT           NOT NULL,
  active            BOOLEAN       NOT NULL DEFAULT TRUE
);

INSERT INTO drugs (aic, name, active_ingredient, atc, pack_size, unit_price, min_stock) VALUES
  ('012345016', 'Metformina 500 mg compresse',            'metformina',             'A10BA02', 30, 2.85, 10),
  ('023456018', 'Ramipril 5 mg compresse',                'ramipril',               'C09AA05', 28, 3.40, 10),
  ('034567010', 'Enoxaparina 4000 UI siringhe',           'enoxaparina',            'B01AB05', 10, 31.20, 10),
  ('045678012', 'Amoxicillina 1 g compresse',             'amoxicillina',           'J01CA04', 12, 5.95, 10),
  ('056789014', 'Ibuprofene 400 mg compresse',            'ibuprofene',             'M01AE01', 30, 3.10, 10),
  ('067890016', 'Warfarin 5 mg compresse',                'warfarin',               'B01AA03', 30, 3.80, 5),
  ('078901018', 'Acido acetilsalicilico 100 mg compresse', 'acido acetilsalicilico', 'B01AC06', 30, 2.05, 10),
  ('089012010', 'Paracetamolo 1000 mg compresse',         'paracetamolo',           'N02BE01', 16, 2.70, 20),
  ('090123012', 'Pantoprazolo 40 mg compresse',           'pantoprazolo',           'A02BC02', 28, 4.60, 10),
  ('101234014', 'Atorvastatina 20 mg compresse',          'atorvastatina',          'C10AA05', 30, 4.20, 10),
  ('112345016', 'Gabapentin 300 mg capsule',              'gabapentin',             'N03AX12', 50, 9.70, 10),
  ('123456018', 'Digossina 0,25 mg compresse',            'digossina',              'C01AA05', 30, 2.25, 5);

CREATE TABLE lots (
  id         BIGINT      PRIMARY KEY,
  aic        VARCHAR(9)  NOT NULL REFERENCES drugs (aic),
  lot_number VARCHAR(20) NOT NULL,
  expiry     DATE        NOT NULL,
  quantity   INT         NOT NULL
);

INSERT INTO lots (id, aic, lot_number, expiry, quantity) VALUES
  (1,  '012345016', 'L-MF2601', '2026-10-31', 6),
  (2,  '012345016', 'L-MF2604', '2027-04-30', 40),
  (3,  '023456018', 'L-RA2602', '2027-02-28', 25),
  (4,  '034567010', 'L-EN2603', '2026-12-15', 8),
  (5,  '034567010', 'L-EN2608', '2027-08-31', 30),
  (6,  '045678012', 'L-AM2605', '2027-05-31', 3),
  (7,  '056789014', 'L-IB2601', '2026-12-31', 18),
  (8,  '067890016', 'L-WA2606', '2027-06-30', 12),
  (9,  '078901018', 'L-AS2602', '2027-02-28', 50),
  (10, '089012010', 'L-PA2603', '2027-03-31', 60),
  (11, '090123012', 'L-PP2604', '2027-04-30', 35),
  (12, '101234014', 'L-AT2605', '2027-05-31', 22),
  (13, '112345016', 'L-GB2606', '2027-06-30', 9),
  (14, '123456018', 'L-DG2607', '2027-07-31', 14);
