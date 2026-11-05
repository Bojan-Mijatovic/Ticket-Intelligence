package com.mediagenda.patient;

import com.mediagenda.common.PageResponse;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/patients")
public class PatientController {

    private final PatientRepository patients;

    public PatientController(PatientRepository patients) {
        this.patients = patients;
    }

    /** GET /api/patients?q=ross&page=0&size=10: search by last name or fiscal code. */
    @GetMapping
    public PageResponse<Patient> search(@RequestParam(defaultValue = "") String q,
                                        @RequestParam(defaultValue = "0") int page,
                                        @RequestParam(defaultValue = "10") int size) {
        PageRequest pageable = PageRequest.of(page, size, Sort.by("lastName", "firstName"));
        return PageResponse.of(patients.findByLastNameContainingIgnoreCaseOrFiscalCodeContainingIgnoreCase(q, q, pageable));
    }
}
