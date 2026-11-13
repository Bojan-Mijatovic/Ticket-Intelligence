package com.medivax.dose;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DoseRepository extends JpaRepository<Dose, Long> {

    List<Dose> findByPatientIdOrderByGivenOnAscIdAsc(Long patientId);

    List<Dose> findByPatientIdAndVaccineCodeOrderByDoseNumber(Long patientId, String vaccineCode);
}
