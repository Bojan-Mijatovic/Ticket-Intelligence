package com.mediagenda.booking;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/** A booking ("prenotazione") of a patient on a time slot. */
@Entity
@Table(name = "bookings")
public class Booking {

    @Id
    private String id;
    @Column(name = "patient_id")
    private Long patientId;
    @Column(name = "time_slot_id")
    private Long timeSlotId;
    @Column(name = "appointment_at")
    private LocalDateTime appointmentAt;
    private String status;

    protected Booking() {}

    public String getId() { return id; }
    public Long getPatientId() { return patientId; }
    public Long getTimeSlotId() { return timeSlotId; }
    public LocalDateTime getAppointmentAt() { return appointmentAt; }
    public String getStatus() { return status; }
}
