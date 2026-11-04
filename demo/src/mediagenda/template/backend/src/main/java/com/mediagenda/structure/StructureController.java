package com.mediagenda.structure;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Autocomplete for the "Struttura" field: search by code or name. */
@RestController
@RequestMapping("/api/structures")
public class StructureController {

    private final StructureRepository structures;

    public StructureController(StructureRepository structures) {
        this.structures = structures;
    }

    @GetMapping
    public List<Structure> search(@RequestParam(defaultValue = "") String q) {
        return structures.findTop10ByIdContainingIgnoreCaseOrNameContainingIgnoreCaseOrderByIdAsc(q, q);
    }
}
