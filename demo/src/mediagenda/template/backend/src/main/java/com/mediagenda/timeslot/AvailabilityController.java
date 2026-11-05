package com.mediagenda.timeslot;

import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/agenda")
public class AvailabilityController {

    private final AvailabilityService service;

    public AvailabilityController(AvailabilityService service) {
        this.service = service;
    }

    /** GET /api/agenda/availability?resourceCode=CA_CARDIOLOGIA&date=2026-11-17: free times of a provider on a day. */
    @GetMapping("/availability")
    public List<AvailableTime> availability(@RequestParam String resourceCode,
                                            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        return service.forResource(resourceCode, date);
    }
}
