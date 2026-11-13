package com.medivax.lot;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LotRepository extends JpaRepository<Lot, String> {

    List<Lot> findByVaccineCodeOrderByExpiry(String vaccineCode);
}
