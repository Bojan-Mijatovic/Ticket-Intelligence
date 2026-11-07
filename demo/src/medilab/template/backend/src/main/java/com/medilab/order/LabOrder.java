package com.medilab.order;

import com.medilab.common.ConflictException;
import com.medilab.integration.PatientInfo;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * A test request ("richiesta di esami") for a MediAgenda patient. The patient's data is copied when the request is
 * made, so a report always shows the patient as they were registered at that time.
 */
@Entity
@Table(name = "lab_orders")
public class LabOrder {

    @Id
    private String id;
    @Column(name = "patient_id")
    private Long patientId;
    @Column(name = "fiscal_code")
    private String fiscalCode;
    @Column(name = "patient_name")
    private String patientName;
    private String sex;
    @Column(name = "birth_date")
    private LocalDate birthDate;
    private String prescriber;
    @Column(name = "prescription_code")
    private String prescriptionCode;
    private boolean urgent;
    private String status;
    @Column(name = "requested_at")
    private LocalDateTime requestedAt;
    @Column(name = "reported_at")
    private LocalDateTime reportedAt;
    @Column(name = "cancel_reason")
    private String cancelReason;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "order_items", joinColumns = @JoinColumn(name = "order_id"))
    @Column(name = "exam_code")
    private List<String> examCodes = new ArrayList<>();

    protected LabOrder() {}

    static LabOrder create(String id, PatientInfo patient, OrderRequest request, List<String> examCodes, LocalDateTime now) {
        LabOrder o = new LabOrder();
        o.id = id;
        o.patientId = patient.id();
        o.fiscalCode = patient.fiscalCode();
        o.patientName = patient.displayName();
        o.sex = patient.sex();
        o.birthDate = patient.birthDate();
        o.prescriber = request.prescriber().trim();
        o.prescriptionCode = request.prescriptionCode() == null || request.prescriptionCode().isBlank() ? null : request.prescriptionCode().toUpperCase();
        o.urgent = request.urgent();
        o.status = OrderStatus.RICHIESTA;
        o.requestedAt = now;
        o.examCodes = new ArrayList<>(examCodes);
        return o;
    }

    /** All samples accepted: the laboratory works on it. */
    public void startWork() {
        if (OrderStatus.RICHIESTA.equals(status)) status = OrderStatus.IN_LAVORAZIONE;
    }

    /** Results validated: the report is out. */
    public void report(LocalDateTime at) {
        if (!OrderStatus.IN_LAVORAZIONE.equals(status)) {
            throw new ConflictException("status: only a request " + OrderStatus.IN_LAVORAZIONE + " can be reported (" + id + " is " + status + ")");
        }
        status = OrderStatus.REFERTATA;
        reportedAt = at;
    }

    void cancel(String reason) {
        if (!OrderStatus.RICHIESTA.equals(status)) {
            throw new ConflictException("status: only a request " + OrderStatus.RICHIESTA + " can be cancelled (" + id + " is " + status + ")");
        }
        status = OrderStatus.ANNULLATA;
        cancelReason = reason.trim();
    }

    public boolean isOpen() {
        return OrderStatus.RICHIESTA.equals(status) || OrderStatus.IN_LAVORAZIONE.equals(status);
    }

    public String getId() { return id; }
    public Long getPatientId() { return patientId; }
    public String getFiscalCode() { return fiscalCode; }
    public String getPatientName() { return patientName; }
    public String getSex() { return sex; }
    public LocalDate getBirthDate() { return birthDate; }
    public String getPrescriber() { return prescriber; }
    public String getPrescriptionCode() { return prescriptionCode; }
    public boolean isUrgent() { return urgent; }
    public String getStatus() { return status; }
    public LocalDateTime getRequestedAt() { return requestedAt; }
    public LocalDateTime getReportedAt() { return reportedAt; }
    public String getCancelReason() { return cancelReason; }
    public List<String> getExamCodes() { return examCodes; }
}
