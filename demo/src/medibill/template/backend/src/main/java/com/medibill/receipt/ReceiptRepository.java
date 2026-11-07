package com.medibill.receipt;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface ReceiptRepository extends JpaRepository<Receipt, String> {

    List<Receipt> findAllByOrderByIssuedAtDesc();

    @Query(value = "SELECT NEXT VALUE FOR receipt_seq", nativeQuery = true)
    long nextNumber();
}
