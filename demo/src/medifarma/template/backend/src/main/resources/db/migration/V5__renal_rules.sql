-- CUP_FAR-211: renal dose rules (eGFR thresholds, mL/min/1.73 m²) and the eGFR used when a prescription is issued.
ALTER TABLE drugs ADD COLUMN renal_reduce_below INT;
ALTER TABLE drugs ADD COLUMN renal_avoid_below INT;
ALTER TABLE drugs ADD COLUMN renal_note VARCHAR(200);

UPDATE drugs SET renal_reduce_below = 45, renal_avoid_below = 30, renal_note = 'Max 1000 mg/die sotto 45; rischio di acidosi lattica' WHERE aic = '012345016';
UPDATE drugs SET renal_reduce_below = 30, renal_note = '2000 UI una volta al giorno sotto 30' WHERE aic = '034567010';
UPDATE drugs SET renal_reduce_below = 30, renal_note = 'Allungare l''intervallo a 12 ore sotto 30' WHERE aic = '045678012';
UPDATE drugs SET renal_avoid_below = 30, renal_note = 'FANS: peggiorano la funzione renale' WHERE aic = '056789014';
UPDATE drugs SET renal_reduce_below = 60, renal_note = 'Ridurre la dose giornaliera secondo la clearance' WHERE aic = '112345016';
UPDATE drugs SET renal_reduce_below = 50, renal_note = 'Ridurre la dose e controllare la digossinemia' WHERE aic = '123456018';

ALTER TABLE prescriptions ADD COLUMN egfr INT;
