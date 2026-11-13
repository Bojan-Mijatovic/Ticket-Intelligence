package com.medivax.vaccine;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface VaccineRepository extends JpaRepository<Vaccine, String> {

    List<Vaccine> findAllByOrderByName();
}
