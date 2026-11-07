package com.medibill.tariff;

import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TariffRepository extends JpaRepository<Tariff, String> {

    List<Tariff> findByActiveTrueOrderByKindAscCodeAsc();

    /** The visit tariff of a MediAgenda provider (resource code). */
    Optional<Tariff> findByMediagendaResourceAndActiveTrue(String resourceCode);
}
