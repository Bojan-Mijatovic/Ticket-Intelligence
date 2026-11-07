package com.medilab.result;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Results of a patient for the other applications of the suite (MediFarma reads the latest creatinine for its renal
 * dose check). Only validated results, newest first, each with its unit.
 */
@RestController
@RequestMapping("/api/patients/{fiscalCode}/results")
public class PatientResultController {

    private final ResultService service;

    public PatientResultController(ResultService service) {
        this.service = service;
    }

    /** GET /api/patients/MRNPLA61S03C351V/results?exam=CREA */
    @GetMapping
    public List<PatientResult> list(@PathVariable String fiscalCode, @RequestParam(required = false) String exam) {
        return service.ofPatient(fiscalCode, exam);
    }
}
