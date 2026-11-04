package com.mediagenda.timeslot;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest
class TimeSlotServiceTest {

    @Autowired
    TimeSlotService service;

    @Test
    void returnsOnlyTheSlotsOfTheRequestedStructure() {
        List<TimeSlot> slots = service.search(new TimeSlotSearchRequest(List.of("SVIL_MS_VISITE")));
        assertThat(slots).isNotEmpty().allMatch(s -> s.getStructureId().equals("SVIL_MS_VISITE"));
    }

    @Test
    void mergesSlotsOfSeveralStructures() {
        List<TimeSlot> slots = service.search(new TimeSlotSearchRequest(List.of("SVIL_MS_VISITE", "TEST_GEN_25")));
        assertThat(slots).extracting(TimeSlot::getStructureId).contains("SVIL_MS_VISITE", "TEST_GEN_25");
    }
}
