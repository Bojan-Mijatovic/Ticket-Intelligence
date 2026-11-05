-- Patient registry form (CUP_DEMO-2441): sex, city and contacts; ids for new patients come from a sequence.
ALTER TABLE patients ADD COLUMN sex CHAR(1);
ALTER TABLE patients ADD COLUMN city VARCHAR(60);
ALTER TABLE patients ADD COLUMN phone VARCHAR(20);
ALTER TABLE patients ADD COLUMN email VARCHAR(120);

UPDATE patients SET sex = CASE WHEN id IN (2, 4, 6, 8, 10, 12) THEN 'F' ELSE 'M' END;
UPDATE patients SET city = 'Milano' WHERE id IN (1, 2, 6, 12);
UPDATE patients SET city = 'Bergamo' WHERE id IN (3, 7, 9);
UPDATE patients SET city = 'Lodi' WHERE id IN (4, 8, 11);
UPDATE patients SET city = 'Casale Monferrato' WHERE id IN (5, 10);

CREATE SEQUENCE patient_seq START WITH 100;
