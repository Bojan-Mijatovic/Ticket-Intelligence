package com.medilab.sample;

import com.medilab.common.ConflictException;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;

/**
 * One tube of a request, labelled with a barcode. ATTESO (waiting for the sample) → ACCETTATO at the acceptance
 * desk, or RIFIUTATO (haemolysed, clotted, …) and replaced by a new tube; ANNULLATO when the request is cancelled.
 */
@Entity
@Table(name = "samples")
public class Sample {

    public static final String ATTESO = "ATTESO";
    public static final String ACCETTATO = "ACCETTATO";
    public static final String RIFIUTATO = "RIFIUTATO";
    public static final String ANNULLATO = "ANNULLATO";

    @Id
    private String barcode;
    @Column(name = "order_id")
    private String orderId;
    @Column(name = "sample_type")
    private String sampleType;
    private String status;
    @Column(name = "accepted_at")
    private LocalDateTime acceptedAt;
    @Column(name = "reject_reason")
    private String rejectReason;
    @Column(name = "replaced_by")
    private String replacedBy;

    protected Sample() {}

    public static Sample waiting(String barcode, String orderId, String sampleType) {
        Sample s = new Sample();
        s.barcode = barcode;
        s.orderId = orderId;
        s.sampleType = sampleType;
        s.status = ATTESO;
        return s;
    }

    void accept(LocalDateTime at) {
        requireWaiting();
        status = ACCETTATO;
        acceptedAt = at;
    }

    void reject(String reason) {
        requireWaiting();
        status = RIFIUTATO;
        rejectReason = reason.trim();
    }

    void replaceWith(String newBarcode) {
        replacedBy = newBarcode;
    }

    public void cancel() {
        if (ATTESO.equals(status)) status = ANNULLATO;
    }

    private void requireWaiting() {
        if (!ATTESO.equals(status)) throw new ConflictException("status: sample " + barcode + " is " + status + ", not " + ATTESO);
    }

    public String getBarcode() { return barcode; }
    public String getOrderId() { return orderId; }
    public String getSampleType() { return sampleType; }
    public String getStatus() { return status; }
    public LocalDateTime getAcceptedAt() { return acceptedAt; }
    public String getRejectReason() { return rejectReason; }
    public String getReplacedBy() { return replacedBy; }
}
