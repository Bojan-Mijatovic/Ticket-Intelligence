package com.medifarma.drug;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DrugRepository extends JpaRepository<Drug, String> {

    List<Drug> findByActiveTrueOrderByNameAsc();

    List<Drug> findByActiveTrueAndNameContainingIgnoreCaseOrActiveTrueAndActiveIngredientContainingIgnoreCaseOrderByNameAsc(String name, String ingredient);
}
