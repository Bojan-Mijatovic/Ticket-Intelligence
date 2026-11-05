package com.mediagenda.timeslot;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mediagenda.common.BadRequestException;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class TimeSlotAdminServiceTest {

    @Autowired
    TimeSlotAdminService service;

    private static TimeSlotCreateRequest request(List<String> weekdays, LocalTime start, LocalTime end) {
        return new TimeSlotCreateRequest("TG_RADIOLOGIA", "Ecografia", weekdays, start, end,
                LocalDate.of(2027, 1, 1), LocalDate.of(2027, 6, 30), "B");
    }

    @Test
    void createsOneSlotPerWeekday() {
        List<TimeSlot> created = service.create(request(List.of("martedì", "giovedì"), LocalTime.of(9, 0), LocalTime.of(11, 0)));
        assertThat(created).extracting(TimeSlot::getWeekday).containsExactly("martedì", "giovedì");
        TimeSlot first = created.get(0);
        assertThat(first.getId()).isGreaterThanOrEqualTo(200000L);
        assertThat(first.getAgendaName()).isEqualTo("ECOGRAFIA");
        assertThat(first.getFrequency()).isEqualTo("09:00-11:00, ogni martedì");
        assertThat(first.getPriority()).isEqualTo("B - BREVE");
        assertThat(first.getStructureId()).isEqualTo("TEST_GEN_25");
        assertThat(first.getCalendarEndDate()).isEqualTo(LocalDate.of(2027, 6, 29));
    }

    @Test
    void rejectsAnEndTimeBeforeTheStartTime() {
        assertThatThrownBy(() -> service.create(request(List.of("lunedì"), LocalTime.of(12, 0), LocalTime.of(9, 0))))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("endTime");
    }

    @Test
    void rejectsAnInactiveResource() {
        TimeSlotCreateRequest r = new TimeSlotCreateRequest("MS_ALLERGOLOGIA", "Allergologia", List.of("lunedì"),
                LocalTime.of(9, 0), LocalTime.of(10, 0), LocalDate.of(2027, 1, 1), LocalDate.of(2027, 2, 1), "P");
        assertThatThrownBy(() -> service.create(r)).isInstanceOf(BadRequestException.class);
    }
}
