package com.mediagenda.timeslot;

import static org.assertj.core.api.Assertions.assertThat;

import com.mediagenda.booking.BookingRequest;
import com.mediagenda.booking.BookingService;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class AvailabilityServiceTest {

    @Autowired
    AvailabilityService availability;
    @Autowired
    BookingService bookings;

    private static LocalDate nextTuesday() {
        return LocalDate.now().plusDays(1).with(TemporalAdjusters.nextOrSame(DayOfWeek.TUESDAY));
    }

    @Test
    void splitsTheSlotIntoTwentyMinuteAppointments() {
        // CA_CARDIOLOGIA: martedì 13:30-16:30 → 13:30, 13:50, …, 16:10 (9 appointments).
        List<AvailableTime> free = availability.forResource("CA_CARDIOLOGIA", nextTuesday());
        assertThat(free).hasSize(9);
        assertThat(free.get(0).startAt().toLocalTime()).hasToString("13:30");
        assertThat(free.get(8).startAt().toLocalTime()).hasToString("16:10");
    }

    @Test
    void doesNotOfferABookedTime() {
        LocalDateTime at = nextTuesday().atTime(14, 10);
        bookings.create(new BookingRequest(2L, 143278L, at, "P", null, null));
        assertThat(availability.forResource("CA_CARDIOLOGIA", nextTuesday())).extracting(AvailableTime::startAt).doesNotContain(at);
    }

    @Test
    void offersNothingOnADayWithoutSlotsOrInThePast() {
        assertThat(availability.forResource("CA_CARDIOLOGIA", nextTuesday().plusDays(1))).isEmpty();
        assertThat(availability.forResource("CA_CARDIOLOGIA", LocalDate.now().minusDays(7))).isEmpty();
    }
}
