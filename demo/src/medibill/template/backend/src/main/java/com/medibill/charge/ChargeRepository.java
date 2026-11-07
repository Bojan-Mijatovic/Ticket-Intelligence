package com.medibill.charge;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChargeRepository extends JpaRepository<Charge, Long> {

    boolean existsBySourceAndSourceRef(String source, String sourceRef);

    List<Charge> findAllByOrderByServiceDateDescIdAsc();

    List<Charge> findByFiscalCodeIgnoreCaseAndStatusOrderByServiceDateAscIdAsc(String fiscalCode, String status);

    List<Charge> findByReceiptIdOrderByServiceDateAscIdAsc(String receiptId);
}
