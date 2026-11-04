package com.mediagenda.timeslot;

import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class TimeSlotService {

    private final TimeSlotRepository timeSlots;

    public TimeSlotService(TimeSlotRepository timeSlots) {
        this.timeSlots = timeSlots;
    }

    public List<TimeSlot> search(TimeSlotSearchRequest request) {
        return timeSlots.findByStructureIdOrderByIdAsc(request.structureId());
    }
}
