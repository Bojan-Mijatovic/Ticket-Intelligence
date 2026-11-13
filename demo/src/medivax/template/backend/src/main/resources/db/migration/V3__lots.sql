-- Vaccine lots in the fridge: a dose can be given from a lot until its expiry day, included.
CREATE TABLE lots (
  code          VARCHAR(20)  PRIMARY KEY,
  vaccine_code  VARCHAR(10)  NOT NULL REFERENCES vaccines(code),
  expiry        DATE         NOT NULL,
  doses_left    INT          NOT NULL
);

INSERT INTO lots (code, vaccine_code, expiry, doses_left) VALUES
  ('ESA-24A', 'ESA', '2026-06-30', 0),
  ('ESA-25A', 'ESA', '2026-11-30', 10),
  ('ESA-25B', 'ESA', '2027-03-31', 40),
  ('MPRV-25C', 'MPRV', '2027-01-31', 25),
  ('HPV-24X', 'HPV', '2026-09-30', 5),
  ('HPV-25D', 'HPV', '2026-12-31', 30),
  ('TDAP-26A', 'TDAP', '2028-02-29', 50),
  ('INFL-25N', 'INFL', '2026-05-31', 0),
  ('INFL-26N', 'INFL', '2027-05-31', 200),
  ('HZV-26B', 'HZV', '2027-08-31', 20),
  ('PCV-26C', 'PCV', '2027-10-31', 15);
