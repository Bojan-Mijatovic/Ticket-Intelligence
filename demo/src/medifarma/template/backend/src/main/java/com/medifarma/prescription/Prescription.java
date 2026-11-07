package com.medifarma.prescription;

import com.medifarma.common.ConflictException;
import com.medifarma.integration.PatientInfo;
import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/** A prescription for a MediAgenda patient: EMESSA → DISPENSATA by the pharmacy, or ANNULLATA. */
@Entity
@Table(name = "prescriptions")
public class Prescription {

    public static final String EMESSA = "EMESSA";
    public static final String DISPENSATA = "DISPENSATA";
    public static final String ANNULLATA = "ANNULLATA";

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
    private String status;
    @Column(name = "issued_at")
    private LocalDateTime issuedAt;
    /** The eGFR the renal check used when the prescription was issued (null: no creatinine in MediLab). */
    private Integer egfr;
    @Column(name = "warnings_acknowledged")
    private boolean warningsAcknowledged;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "prescription_items", joinColumns = @JoinColumn(name = "prescription_id"))
    @OrderColumn(name = "line_no")
    private List<PrescriptionItem> items = new ArrayList<>();

    protected Prescription() {}

    static Prescription issue(String id, PatientInfo p, String prescriber, List<PrescriptionItem> items, Integer egfr, boolean acknowledged, LocalDateTime now) {
        Prescription rx = new Prescription();
        rx.id = id;
        rx.patientId = p.id();
        rx.fiscalCode = p.fiscalCode();
        rx.patientName = p.displayName();
        rx.sex = p.sex();
        rx.birthDate = p.birthDate();
        rx.prescriber = prescriber.trim();
        rx.status = EMESSA;
        rx.issuedAt = now;
        rx.egfr = egfr;
        rx.warningsAcknowledged = acknowledged;
        rx.items = new ArrayList<>(items);
        return rx;
    }

    /** Dispensed by the pharmacy (DispensingService). */
    public void dispensed() {
        requireIssued("dispensed");
        status = DISPENSATA;
    }

    void cancel() {
        requireIssued("cancelled");
        status = ANNULLATA;
    }

    private void requireIssued(String what) {
        if (!EMESSA.equals(status)) throw new ConflictException("status: only a prescription " + EMESSA + " can be " + what + " (" + id + " is " + status + ")");
    }

    public String getId() { return id; }
    public Long getPatientId() { return patientId; }
    public String getFiscalCode() { return fiscalCode; }
    public String getPatientName() { return patientName; }
    public String getSex() { return sex; }
    public LocalDate getBirthDate() { return birthDate; }
    public String getPrescriber() { return prescriber; }
    public String getStatus() { return status; }
    public LocalDateTime getIssuedAt() { return issuedAt; }
    public Integer getEgfr() { return egfr; }
    public boolean isWarningsAcknowledged() { return warningsAcknowledged; }
    public List<PrescriptionItem> getItems() { return items; }
}
