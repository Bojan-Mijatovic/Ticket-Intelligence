package com.medifarma.stock;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LotRepository extends JpaRepository<Lot, Long> {

    /** The lots of a drug, the one that expires first first (FEFO: first expired, first out). */
    List<Lot> findByAicOrderByExpiryAscIdAsc(String aic);

    List<Lot> findAllByOrderByExpiryAsc();
}
