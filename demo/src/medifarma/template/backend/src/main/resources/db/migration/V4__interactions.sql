-- CUP_FAR-209: drug interactions by active ingredient; a prescription records whether its high warnings were
-- acknowledged by the prescriber.
CREATE TABLE interaction_rules (
  id           BIGINT       PRIMARY KEY,
  ingredient_a VARCHAR(60)  NOT NULL,
  ingredient_b VARCHAR(60)  NOT NULL,
  severity     VARCHAR(10)  NOT NULL,
  note         VARCHAR(200) NOT NULL
);

INSERT INTO interaction_rules (id, ingredient_a, ingredient_b, severity, note) VALUES
  (1, 'warfarin', 'ibuprofene',             'ALTA',  'Rischio emorragico: evitare i FANS con gli anticoagulanti orali'),
  (2, 'warfarin', 'acido acetilsalicilico', 'ALTA',  'Rischio emorragico: associare solo su indicazione specialistica'),
  (3, 'ramipril', 'ibuprofene',             'MEDIA', 'Ridotto effetto antipertensivo e rischio di danno renale'),
  (4, 'digossina', 'amoxicillina',          'MEDIA', 'Possibile aumento della digossinemia: controllare i livelli');

ALTER TABLE prescriptions ADD COLUMN warnings_acknowledged BOOLEAN DEFAULT FALSE NOT NULL;
