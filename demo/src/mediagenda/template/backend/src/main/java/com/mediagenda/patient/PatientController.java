package com.mediagenda.patient;

import com.mediagenda.common.PageResponse;
import jakarta.validation.Valid;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/patients")
public class PatientController {

    private final PatientRepository patients;
    private final PatientService service;

    public PatientController(PatientRepository patients, PatientService service) {
        this.patients = patients;
        this.service = service;
    }

    /** GET /api/patients?q=ross&page=0&size=10: search by last name or fiscal code. */
    @GetMapping
    public PageResponse<Patient> search(@RequestParam(defaultValue = "") String q,
                                        @RequestParam(defaultValue = "0") int page,
                                        @RequestParam(defaultValue = "10") int size) {
        PageRequest pageable = PageRequest.of(page, size, Sort.by("lastName", "firstName"));
        return PageResponse.of(patients.findByLastNameContainingIgnoreCaseOrFiscalCodeContainingIgnoreCase(q, q, pageable));
    }

    @GetMapping("/{id}")
    public Patient get(@PathVariable Long id) {
        return service.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Patient create(@Valid @RequestBody PatientRequest request) {
        return service.create(request);
    }

    @PutMapping("/{id}")
    public Patient update(@PathVariable Long id, @Valid @RequestBody PatientRequest request) {
        return service.update(id, request);
    }
}
