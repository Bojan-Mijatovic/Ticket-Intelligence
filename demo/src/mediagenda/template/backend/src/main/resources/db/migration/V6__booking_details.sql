-- New booking form (CUP_DEMO-2470): priority class, electronic prescription number (NRE), notes; ids from a sequence.
ALTER TABLE bookings ADD COLUMN priority CHAR(1);
ALTER TABLE bookings ADD COLUMN prescription_code VARCHAR(15);
ALTER TABLE bookings ADD COLUMN notes VARCHAR(500);
ALTER TABLE bookings ADD COLUMN created_at TIMESTAMP;

UPDATE bookings SET priority = 'P', created_at = DATEADD('DAY', -14, appointment_at);
UPDATE bookings SET prescription_code = '0301A4000112233' WHERE id = 'PR-2026-00561';

CREATE SEQUENCE booking_seq START WITH 600;
