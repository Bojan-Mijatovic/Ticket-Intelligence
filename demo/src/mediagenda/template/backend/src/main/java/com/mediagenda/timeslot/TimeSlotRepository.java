package com.mediagenda.timeslot;

import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TimeSlotRepository extends JpaRepository<TimeSlot, Long> {

    List<TimeSlot> findByStructureIdInOrderByIdAsc(Collection<String> structureIds);

    List<TimeSlot> findByResourceCodeAndWeekdayOrderByStartTimeAsc(String resourceCode, String weekday);
}
