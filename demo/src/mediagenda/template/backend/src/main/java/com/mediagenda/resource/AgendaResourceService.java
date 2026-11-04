package com.mediagenda.resource;

import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class AgendaResourceService {

    private final AgendaResourceRepository resources;

    public AgendaResourceService(AgendaResourceRepository resources) {
        this.resources = resources;
    }

    /** Active providers of the given structures (CUP_DEMO-2602: inactive ones must not be offered). */
    public List<AgendaResource> forStructures(List<String> structureIds) {
        return resources.findByStructureIdInAndActiveTrueOrderByCodeAsc(structureIds);
    }
}
