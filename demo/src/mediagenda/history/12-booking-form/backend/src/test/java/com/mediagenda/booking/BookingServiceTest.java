package com.mediagenda.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mediagenda.common.BadRequestException;
import com.mediagenda.common.ConflictException;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.temporal.TemporalAdjusters;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class BookingServiceTest {

    /** AMBULATORIO DI CARDIOLOGIA, martedì 13:30-16:30 (V2 seed). */
    static final long CARDIOLOGY_TUESDAY = 143278L;

    @Autowired
    BookingService service;

    private static LocalDateTime nextTuesdayAt(int hour, int minute) {
        return LocalDate.now().plusDays(1).with(TemporalAdjusters.nextOrSame(DayOfWeek.TUESDAY)).atTime(LocalTime.of(hour, minute));
    }

    private static BookingRequest request(LocalDateTime at) {
        return new BookingRequest(3L, CARDIOLOGY_TUESDAY, at, "B", "0301A4000998877", null);
    }

    @Test
    void createsAConfirmedBookingWithPatientAndAgenda() {
        BookingView b = service.create(request(nextTuesdayAt(13, 50)));
        assertThat(b.id()).matches("PR-\\d{4}-\\d{5}");
        assertThat(b.status()).isEqualTo(Booking.CONFIRMED);
        assertThat(b.patientName()).isEqualTo("Verdi Giuseppe");
        assertThat(b.agendaName()).isEqualTo("AMBULATORIO DI CARDIOLOGIA");
    }

    @Test
    void rejectsADayThatIsNotTheWeekdayOfTheSlot() {
        assertThatThrownBy(() -> service.create(request(nextTuesdayAt(13, 50).plusDays(1))))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("martedì");
    }

    @Test
    void rejectsATimeOutsideTheSlot() {
        assertThatThrownBy(() -> service.create(request(nextTuesdayAt(9, 0))))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void rejectsATimeThatIsAlreadyBooked() {
        service.create(request(nextTuesdayAt(14, 30)));
        assertThatThrownBy(() -> service.create(request(nextTuesdayAt(14, 30))))
                .isInstanceOf(ConflictException.class);
    }

}
