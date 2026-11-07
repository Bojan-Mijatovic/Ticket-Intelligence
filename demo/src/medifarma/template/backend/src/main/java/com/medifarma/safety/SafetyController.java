package com.medifarma.safety;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/safety")
public class SafetyController {

    private final SafetyService service;

    public SafetyController(SafetyService service) {
        this.service = service;
    }

    /** POST /api/safety/check { patientId, aics }: the warnings panel, before the prescription is issued. */
    @PostMapping("/check")
    public SafetyCheck check(@Valid @RequestBody SafetyRequest request) {
        return service.check(request);
    }
}
