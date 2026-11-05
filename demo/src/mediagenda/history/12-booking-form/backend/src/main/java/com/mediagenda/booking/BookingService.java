package com.mediagenda.booking;

import com.mediagenda.common.BadRequestException;
import com.mediagenda.common.ConflictException;
import com.mediagenda.common.NotFoundException;
import com.mediagenda.patient.PatientRepository;
import com.mediagenda.timeslot.TimeSlot;
import com.mediagenda.timeslot.TimeSlotRepository;
import com.mediagenda.timeslot.Weekdays;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Bookings: list (with patient and agenda) and create on a free time of a slot. */
@Service
public class BookingService {

    private static final String SELECT_VIEW = """
            SELECT b.id, b.appointment_at, b.status, b.priority, b.patient_id,
                   p.last_name || ' ' || p.first_name AS patient_name, p.fiscal_code,
                   b.time_slot_id, t.agenda_name, t.structure_id, t.resource_code,
                   b.prescription_code, b.notes
            FROM bookings b
            JOIN patients p ON p.id = b.patient_id
            JOIN time_slots t ON t.id = b.time_slot_id
            """;

    private static final RowMapper<BookingView> VIEW = (rs, i) -> new BookingView(
            rs.getString("id"),
            rs.getTimestamp("appointment_at").toLocalDateTime(),
            rs.getString("status"),
            rs.getString("priority"),
            rs.getLong("patient_id"),
            rs.getString("patient_name"),
            rs.getString("fiscal_code"),
            rs.getLong("time_slot_id"),
            rs.getString("agenda_name"),
            rs.getString("structure_id"),
            rs.getString("resource_code"),
            rs.getString("prescription_code"),
            rs.getString("notes"));

    private final BookingRepository bookings;
    private final TimeSlotRepository timeSlots;
    private final PatientRepository patients;
    private final JdbcTemplate jdbc;

    public BookingService(BookingRepository bookings, TimeSlotRepository timeSlots, PatientRepository patients, JdbcTemplate jdbc) {
        this.bookings = bookings;
        this.timeSlots = timeSlots;
        this.patients = patients;
        this.jdbc = jdbc;
    }

    /** All bookings, newest appointment first. */
    public List<BookingView> list() {
        return jdbc.query(SELECT_VIEW + "ORDER BY b.appointment_at DESC", VIEW);
    }

    public BookingView get(String id) {
        return jdbc.query(SELECT_VIEW + "WHERE b.id = ?", VIEW, id).stream().findFirst()
                .orElseThrow(() -> new NotFoundException("Booking", id));
    }

    @Transactional
    public BookingView create(BookingRequest r) {
        TimeSlot slot = timeSlots.findById(r.timeSlotId()).orElseThrow(() -> new NotFoundException("Time slot", r.timeSlotId()));
        if (!patients.existsById(r.patientId())) {
            throw new NotFoundException("Patient", r.patientId());
        }
        LocalDate day = r.appointmentAt().toLocalDate();
        LocalTime time = r.appointmentAt().toLocalTime();
        if (day.isBefore(slot.getStartDate()) || day.isAfter(slot.getEndDate())) {
            throw new BadRequestException("appointmentAt: outside the validity of time slot " + slot.getId());
        }
        if (!Weekdays.italian(day.getDayOfWeek()).equals(slot.getWeekday())) {
            throw new BadRequestException("appointmentAt: time slot " + slot.getId() + " is on " + slot.getWeekday());
        }
        if (time.isBefore(slot.getStartTime()) || !time.isBefore(slot.getEndTime())) {
            throw new BadRequestException("appointmentAt: outside " + slot.getStartTime() + "-" + slot.getEndTime());
        }
        if (bookings.existsByTimeSlotIdAndAppointmentAt(slot.getId(), r.appointmentAt())) {
            throw new ConflictException("appointmentAt: " + r.appointmentAt() + " is already booked");
        }
        Long next = jdbc.queryForObject("SELECT NEXT VALUE FOR booking_seq", Long.class);
        String id = String.format("PR-%d-%05d", LocalDate.now().getYear(), next);
        bookings.saveAndFlush(Booking.confirmed(id, r));
        return get(id);
    }

}
