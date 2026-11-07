package com.medilab.integration;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The patient picker of "Nuova richiesta": MediAgenda's registry, through MediLab (the browser only talks to us). */
@RestController
@RequestMapping("/api/mediagenda/patients")
public class PatientLookupController {

    private final MediAgendaClient mediAgenda;

    public PatientLookupController(MediAgendaClient mediAgenda) {
        this.mediAgenda = mediAgenda;
    }

    /** GET /api/mediagenda/patients?q=ross: at least 2 characters, otherwise an empty list. */
    @GetMapping
    public List<PatientInfo> search(@RequestParam(defaultValue = "") String q) {
        String term = q.trim();
        return term.length() < 2 ? List.of() : mediAgenda.search(term);
    }
}
