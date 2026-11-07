-- CUP_LAB-112: a rejected tube is replaced by a new one (new barcode); the rejected one points to it.
ALTER TABLE samples ADD COLUMN replaced_by VARCHAR(12);
