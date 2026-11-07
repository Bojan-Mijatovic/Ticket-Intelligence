package com.medifarma.dispensing;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DispensingRepository extends JpaRepository<Dispensing, Long> {

    List<Dispensing> findByPrescriptionId(String prescriptionId);
}
