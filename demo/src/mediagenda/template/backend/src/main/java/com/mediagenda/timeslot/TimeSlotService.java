package com.mediagenda.timeslot;

import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class TimeSlotService {

    private final TimeSlotRepository timeSlots;

    public TimeSlotService(TimeSlotRepository timeSlots) {
        this.timeSlots = timeSlots;
    }

    /** All time slots of every requested structure, merged into one list. */
    public List<TimeSlot> search(TimeSlotSearchRequest request) {
        return timeSlots.findByStructureIdInOrderByIdAsc(request.structureIds());
    }
}
