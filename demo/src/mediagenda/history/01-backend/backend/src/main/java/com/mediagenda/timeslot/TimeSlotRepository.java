package com.mediagenda.timeslot;

import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TimeSlotRepository extends JpaRepository<TimeSlot, Long> {

    List<TimeSlot> findByStructureIdOrderByIdAsc(String structureId);
}
