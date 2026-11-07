-- Regional fee schedule ("nomenclatore tariffario"): visits, mapped to the MediAgenda provider (resource code).
CREATE TABLE tariffs (
  code                VARCHAR(12)  PRIMARY KEY,
  description         VARCHAR(120) NOT NULL,
  kind                VARCHAR(20)  NOT NULL,
  price               DECIMAL(8,2) NOT NULL,
  mediagenda_resource VARCHAR(30),
  active              BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO tariffs (code, description, kind, price, mediagenda_resource) VALUES
  ('89.7A.7', 'Prima visita dermatologica',       'VISITA', 22.50, 'MS_DERMATOLOGIA'),
  ('89.7B.7', 'Prima visita ortopedica',          'VISITA', 22.50, 'MS_ORTOPEDIA'),
  ('89.7A.3', 'Prima visita cardiologica',        'VISITA', 22.50, 'CA_CARDIOLOGIA'),
  ('95.02',   'Prima visita oculistica',          'VISITA', 22.50, 'LO_OCULISTICA'),
  ('87.44.1', 'Radiografia del torace',           'VISITA', 15.49, 'TG_RADIOLOGIA'),
  ('91.49.2', 'Prelievo di sangue venoso',        'VISITA', 2.58,  'TG_LABORATORIO');
