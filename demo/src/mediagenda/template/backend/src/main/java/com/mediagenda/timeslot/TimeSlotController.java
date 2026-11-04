package com.mediagenda.timeslot;

import jakarta.validation.Valid;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** "StructuretimeSlot" service used by the Agenda search mask. */
@RestController
@RequestMapping("/api/agenda")
public class TimeSlotController {

    private static final Logger log = LoggerFactory.getLogger(TimeSlotController.class);

    private final TimeSlotService service;

    public TimeSlotController(TimeSlotService service) {
        this.service = service;
    }

    @PostMapping("/structure-timeslots")
    public List<TimeSlot> structureTimeSlots(@Valid @RequestBody TimeSlotSearchRequest request) {
        log.info("StructureTimeSlot search {}", request);
        return service.search(request);
    }
}
