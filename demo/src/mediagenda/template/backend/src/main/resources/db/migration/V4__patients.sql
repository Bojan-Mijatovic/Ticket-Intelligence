CREATE TABLE patients (
  id          BIGINT PRIMARY KEY,
  fiscal_code VARCHAR(16) NOT NULL UNIQUE,
  first_name  VARCHAR(60) NOT NULL,
  last_name   VARCHAR(60) NOT NULL,
  birth_date  DATE        NOT NULL
);

-- Fictional patients.
INSERT INTO patients (id, fiscal_code, first_name, last_name, birth_date) VALUES
  (1,  'RSSMRA80A01F205X', 'Mario',     'Rossi',    '1980-01-01'),
  (2,  'BNCLRA85C45L219Y', 'Laura',     'Bianchi',  '1985-03-05'),
  (3,  'VRDGPP72D12H501Z', 'Giuseppe',  'Verdi',    '1972-04-12'),
  (4,  'FRRGLI90E50A794K', 'Giulia',    'Ferrari',  '1990-05-10'),
  (5,  'RMNLCU66H20D969W', 'Luca',      'Romano',   '1966-06-20'),
  (6,  'GLLSFN78M41F839J', 'Stefania',  'Gallo',    '1978-08-01'),
  (7,  'CSTNDR93P10L736Q', 'Andrea',    'Costa',    '1993-09-10'),
  (8,  'FNTCHR88R55G273T', 'Chiara',    'Fontana',  '1988-10-15'),
  (9,  'MRNPLA61S03C351V', 'Paolo',     'Marino',   '1961-11-03'),
  (10, 'RCCFNC99T47E506M', 'Francesca', 'Ricci',    '1999-12-07'),
  (11, 'BRNMTT83A15B157R', 'Matteo',    'Bruno',    '1983-01-15'),
  (12, 'GRCSRA95B62F205N', 'Sara',      'Greco',    '1995-02-22');
