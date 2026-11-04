package com.mediagenda.structure;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface StructureRepository extends JpaRepository<Structure, String> {

    List<Structure> findTop10ByIdContainingIgnoreCaseOrNameContainingIgnoreCaseOrderByIdAsc(String id, String name);
}
