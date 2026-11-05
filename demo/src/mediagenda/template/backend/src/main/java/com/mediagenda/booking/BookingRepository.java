package com.mediagenda.booking;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface BookingRepository extends JpaRepository<Booking, String> {

    List<Booking> findAllByOrderByAppointmentAtDesc();

    boolean existsByTimeSlotIdAndAppointmentAtAndStatusNot(Long timeSlotId, LocalDateTime appointmentAt, String status);

    /** Appointment times already taken in the given time slots, between from (inclusive) and to (exclusive). */
    @Query("select b.appointmentAt from Booking b where b.timeSlotId in :slotIds and b.appointmentAt >= :from and b.appointmentAt < :to")
    List<LocalDateTime> findBookedTimes(@Param("slotIds") Collection<Long> slotIds, @Param("from") LocalDateTime from, @Param("to") LocalDateTime to);
}
