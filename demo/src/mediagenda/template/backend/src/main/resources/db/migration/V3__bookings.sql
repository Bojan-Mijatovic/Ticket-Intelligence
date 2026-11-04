CREATE TABLE bookings (
  id             VARCHAR(20) PRIMARY KEY,
  patient_id     BIGINT      NOT NULL,
  time_slot_id   BIGINT      NOT NULL REFERENCES time_slots (id),
  appointment_at TIMESTAMP   NOT NULL,
  status         VARCHAR(20) NOT NULL
);

INSERT INTO bookings (id, patient_id, time_slot_id, appointment_at, status) VALUES
  ('PR-2026-00412', 1, 143201, '2026-09-07 09:20:00', 'COMPLETATA'),
  ('PR-2026-00498', 2, 143210, '2026-10-06 10:00:00', 'COMPLETATA'),
  ('PR-2026-00533', 3, 144501, '2026-10-19 08:40:00', 'COMPLETATA'),
  ('PR-2026-00561', 4, 146524, '2026-11-04 09:30:00', 'CONFERMATA'),
  ('PR-2026-00570', 5, 143278, '2026-11-10 14:00:00', 'CONFERMATA'),
  ('PR-2026-00575', 1, 144520, '2026-11-16 08:00:00', 'CONFERMATA');
