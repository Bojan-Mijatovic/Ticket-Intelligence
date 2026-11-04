package com.mediagenda.resource;

import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AgendaResourceRepository extends JpaRepository<AgendaResource, String> {

    List<AgendaResource> findByStructureIdInOrderByCodeAsc(Collection<String> structureIds);

    List<AgendaResource> findByStructureIdInAndActiveTrueOrderByCodeAsc(Collection<String> structureIds);
}
