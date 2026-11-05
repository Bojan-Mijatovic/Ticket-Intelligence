package com.mediagenda.timeslot;

import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/timeslots")
public class TimeSlotAdminController {

    private final TimeSlotAdminService service;

    public TimeSlotAdminController(TimeSlotAdminService service) {
        this.service = service;
    }

    /** POST /api/timeslots: creates one recurring slot per selected weekday. */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public List<TimeSlot> create(@Valid @RequestBody TimeSlotCreateRequest request) {
        return service.create(request);
    }
}
