package com.mediagenda.timeslot;

import com.mediagenda.booking.BookingRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

/** Free appointment times of a provider on a day: each time slot is split into appointments of {@link #STEP}. */
@Service
public class AvailabilityService {

    /** Length of one appointment. */
    static final Duration STEP = Duration.ofMinutes(20);

    private final TimeSlotRepository timeSlots;
    private final BookingRepository bookings;

    public AvailabilityService(TimeSlotRepository timeSlots, BookingRepository bookings) {
        this.timeSlots = timeSlots;
        this.bookings = bookings;
    }

    public List<AvailableTime> forResource(String resourceCode, LocalDate date) {
        if (date.isBefore(LocalDate.now())) {
            return List.of();
        }
        List<TimeSlot> slots = timeSlots.findByResourceCodeAndWeekdayOrderByStartTimeAsc(resourceCode, Weekdays.italian(date.getDayOfWeek()))
                .stream()
                .filter(s -> !date.isBefore(s.getStartDate()) && !date.isAfter(s.getEndDate()))
                .toList();
        if (slots.isEmpty()) {
            return List.of();
        }
        // One query for every booked time of the day, instead of one query per candidate time (CUP_DEMO-2620).
        Set<LocalDateTime> booked = new HashSet<>(bookings.findBookedTimes(
                slots.stream().map(TimeSlot::getId).toList(), date.atStartOfDay(), date.plusDays(1).atStartOfDay()));

        List<AvailableTime> free = new ArrayList<>();
        for (TimeSlot slot : slots) {
            for (LocalTime t = slot.getStartTime(); !t.plus(STEP).isAfter(slot.getEndTime()); t = t.plus(STEP)) {
                LocalDateTime at = date.atTime(t);
                if (!booked.contains(at)) {
                    free.add(AvailableTime.of(slot, at));
                }
            }
        }
        return free;
    }
}
