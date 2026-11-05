package com.mediagenda.timeslot;

import com.mediagenda.common.BadRequestException;
import com.mediagenda.common.NotFoundException;
import com.mediagenda.resource.AgendaResource;
import com.mediagenda.resource.AgendaResourceRepository;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Creates recurring time slots for a provider (CUP_DEMO-2590). */
@Service
public class TimeSlotAdminService {

    /** Priority code → label and rank, as in the existing time slots. */
    private static final Map<String, Map.Entry<String, Integer>> PRIORITIES = Map.of(
            "U", Map.entry("U - URGENTE", 1),
            "B", Map.entry("B - BREVE", 3),
            "D", Map.entry("D - DIFFERITA", 4),
            "P", Map.entry("P - PROGRAMMATO", 5));
    private static final DateTimeFormatter HHMM = DateTimeFormatter.ofPattern("HH:mm");
    private static final DateTimeFormatter CODE = DateTimeFormatter.ofPattern("HHmm");

    private final TimeSlotRepository timeSlots;
    private final AgendaResourceRepository resources;
    private final JdbcTemplate jdbc;

    public TimeSlotAdminService(TimeSlotRepository timeSlots, AgendaResourceRepository resources, JdbcTemplate jdbc) {
        this.timeSlots = timeSlots;
        this.resources = resources;
        this.jdbc = jdbc;
    }

    @Transactional
    public List<TimeSlot> create(TimeSlotCreateRequest r) {
        AgendaResource resource = resources.findById(r.resourceCode()).orElseThrow(() -> new NotFoundException("Resource", r.resourceCode()));
        if (!resource.isActive()) {
            throw new BadRequestException("resourceCode: " + r.resourceCode() + " is not active");
        }
        if (!r.startTime().isBefore(r.endTime())) {
            throw new BadRequestException("endTime: must be after startTime");
        }
        if (r.endDate().isBefore(r.startDate())) {
            throw new BadRequestException("endDate: must not be before startDate");
        }
        Map.Entry<String, Integer> priority = PRIORITIES.get(r.priority());
        String hours = r.startTime().format(HHMM) + "-" + r.endTime().format(HHMM);

        List<TimeSlot> created = new ArrayList<>();
        for (String weekday : r.weekdays().stream().distinct().toList()) {
            Long id = jdbc.queryForObject("SELECT NEXT VALUE FOR time_slot_seq", Long.class);
            created.add(timeSlots.save(TimeSlot.create(
                    id,
                    r.agendaName().trim().toUpperCase(),
                    id + "|" + r.startTime().format(CODE) + "|" + r.endTime().format(CODE),
                    r.startDate(),
                    r.endDate(),
                    hours + ", ogni " + weekday,
                    weekday,
                    r.startTime(),
                    r.endTime(),
                    priority.getKey(),
                    priority.getValue(),
                    r.endDate().with(TemporalAdjusters.previousOrSame(Weekdays.fromItalian(weekday))),
                    resource.getCode(),
                    resource.getStructureId())));
        }
        return created;
    }
}
