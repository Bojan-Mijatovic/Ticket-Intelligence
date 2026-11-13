package com.medivax.schedule;

import com.medivax.schedule.DueService.DueRow;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DueController {

    private final DueService service;

    public DueController(DueService service) {
        this.service = service;
    }

    @GetMapping("/api/due")
    public List<DueRow> due(@RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return service.due(from, to);
    }
}
