package com.mediagenda.resource;

import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class AgendaResourceService {

    private final AgendaResourceRepository resources;

    public AgendaResourceService(AgendaResourceRepository resources) {
        this.resources = resources;
    }

    public List<AgendaResource> forStructures(List<String> structureIds) {
        return resources.findByStructureIdInOrderByCodeAsc(structureIds);
    }
}
