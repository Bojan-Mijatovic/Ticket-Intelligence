package com.medilab.order;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface LabOrderRepository extends JpaRepository<LabOrder, String> {

    List<LabOrder> findAllByOrderByRequestedAtDesc();

    List<LabOrder> findByFiscalCodeIgnoreCase(String fiscalCode);

    @Query(value = "SELECT NEXT VALUE FOR order_seq", nativeQuery = true)
    long nextNumber();
}
