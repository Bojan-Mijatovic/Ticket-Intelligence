package com.medivax.patient;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/patients")
public class PatientController {

    private final PatientService service;

    public PatientController(PatientService service) {
        this.service = service;
    }

    @GetMapping
    public List<Patient> search(@RequestParam(defaultValue = "") String q) {
        return service.search(q);
    }

    @GetMapping("/{id}")
    public Patient get(@PathVariable long id) {
        return service.get(id);
    }
}
