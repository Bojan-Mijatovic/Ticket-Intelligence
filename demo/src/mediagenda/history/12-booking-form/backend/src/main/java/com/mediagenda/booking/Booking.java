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

    public static final String CONFIRMED = "CONFERMATA";
    public static final String COMPLETED = "COMPLETATA";

    @Id
    private String id;
    @Column(name = "patient_id")
    private Long patientId;
    @Column(name = "time_slot_id")
    private Long timeSlotId;
    @Column(name = "appointment_at")
    private LocalDateTime appointmentAt;
    private String status;
    /** Priority class of the prescription: U urgente, B breve, D differibile, P programmata. */
    private String priority;
    /** Electronic prescription number (NRE). */
    @Column(name = "prescription_code")
    private String prescriptionCode;
    private String notes;
    @Column(name = "created_at")
    private LocalDateTime createdAt;

    protected Booking() {}

    static Booking confirmed(String id, BookingRequest r) {
        Booking b = new Booking();
        b.id = id;
        b.patientId = r.patientId();
        b.timeSlotId = r.timeSlotId();
        b.appointmentAt = r.appointmentAt();
        b.status = CONFIRMED;
        b.priority = r.priority();
        b.prescriptionCode = r.prescriptionCode() == null || r.prescriptionCode().isBlank() ? null : r.prescriptionCode().toUpperCase();
        b.notes = r.notes();
        b.createdAt = LocalDateTime.now();
        return b;
    }


    public String getId() { return id; }
    public Long getPatientId() { return patientId; }
    public Long getTimeSlotId() { return timeSlotId; }
    public LocalDateTime getAppointmentAt() { return appointmentAt; }
    public String getStatus() { return status; }
    public String getPriority() { return priority; }
    public String getPrescriptionCode() { return prescriptionCode; }
    public String getNotes() { return notes; }
    public LocalDateTime getCreatedAt() { return createdAt; }
}
