-- Cancel a booking (CUP_DEMO-2533): reason and time of the cancellation.
ALTER TABLE bookings ADD COLUMN cancel_reason VARCHAR(200);
ALTER TABLE bookings ADD COLUMN cancelled_at TIMESTAMP;

INSERT INTO bookings (id, patient_id, time_slot_id, appointment_at, status, priority, created_at, cancel_reason, cancelled_at) VALUES
  ('PR-2026-00590', 7, 143278, '2026-11-17 14:10:00', 'ANNULLATA', 'P', '2026-10-30 10:12:00', 'Richiesta del paziente', '2026-11-02 09:05:00');
