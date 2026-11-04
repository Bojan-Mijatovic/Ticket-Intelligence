package com.mediagenda.resource;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/resources")
public class AgendaResourceController {

    private final AgendaResourceService service;

    public AgendaResourceController(AgendaResourceService service) {
        this.service = service;
    }

    /** GET /api/resources?structureIds=A,B */
    @GetMapping
    public List<AgendaResource> byStructures(@RequestParam List<String> structureIds) {
        return service.forStructures(structureIds);
    }
}
