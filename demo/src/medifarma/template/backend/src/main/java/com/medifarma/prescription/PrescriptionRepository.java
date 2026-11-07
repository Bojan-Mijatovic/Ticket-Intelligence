package com.medifarma.prescription;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface PrescriptionRepository extends JpaRepository<Prescription, String> {

    List<Prescription> findAllByOrderByIssuedAtDesc();

    @Query(value = "SELECT NEXT VALUE FOR prescription_seq", nativeQuery = true)
    long nextNumber();
}
