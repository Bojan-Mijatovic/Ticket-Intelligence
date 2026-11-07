package com.medibill.exemption;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ExemptionRepository extends JpaRepository<Exemption, Long> {

    List<Exemption> findAllByOrderByPatientNameAscValidFromDesc();

    List<Exemption> findByFiscalCodeIgnoreCase(String fiscalCode);
}
