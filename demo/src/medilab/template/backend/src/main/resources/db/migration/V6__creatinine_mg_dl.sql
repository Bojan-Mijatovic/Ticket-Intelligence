-- CUP_LAB-118: creatinine in mg/dL instead of µmol/L, as the nephrology ward and the regional health record (FSE)
-- use it. 1 mg/dL = 88.4 µmol/L; stored results are converted, so old and new reports compare.
UPDATE exams SET unit = 'mg/dL', decimals = 2, ref_min_m = 0.70, ref_max_m = 1.20, ref_min_f = 0.50, ref_max_f = 1.00 WHERE code = 'CREA';
UPDATE results SET result_value = ROUND(result_value / 88.4, 2), unit = 'mg/dL' WHERE exam_code = 'CREA';
