package com.medivax.dose;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DoseController {

    private final DoseService service;

    public DoseController(DoseService service) {
        this.service = service;
    }

    @PostMapping("/api/doses")
    @ResponseStatus(HttpStatus.CREATED)
    public DoseView record(@Valid @RequestBody DoseRequest request) {
        return service.record(request);
    }

    @GetMapping("/api/patients/{id}/card")
    public PatientCard card(@PathVariable long id) {
        return service.card(id);
    }
}
