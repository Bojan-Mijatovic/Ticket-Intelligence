package com.medilab.sample;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface SampleRepository extends JpaRepository<Sample, String> {

    List<Sample> findByOrderIdOrderByBarcodeAsc(String orderId);

    @Query(value = "SELECT NEXT VALUE FOR sample_seq", nativeQuery = true)
    long nextNumber();

    /** Next tube label, e.g. LB00001003. */
    default String nextBarcode() {
        return String.format("LB%08d", nextNumber());
    }
}
