package com.medibill.receipt;

import com.medibill.common.ConflictException;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * A receipt ("ricevuta") for the open charges of a patient: the total at tariff price, the part covered by
 * exemptions, and the co-pay ("ticket") the patient pays. EMESSA → PAGATA, or STORNATA (cancelled) while unpaid.
 */
@Entity
@Table(name = "receipts")
public class Receipt {

    public static final String EMESSA = "EMESSA";
    public static final String PAGATA = "PAGATA";
    public static final String STORNATA = "STORNATA";

    @Id
    private String id;
    @Column(name = "fiscal_code")
    private String fiscalCode;
    @Column(name = "patient_name")
    private String patientName;
    @Column(name = "issued_at")
    private LocalDateTime issuedAt;
    private BigDecimal total;
    private BigDecimal exempt;
    private BigDecimal copay;
    @Column(name = "exemption_codes")
    private String exemptionCodes;
    private String status;
    @Column(name = "paid_at")
    private LocalDateTime paidAt;

    protected Receipt() {}

    static Receipt issue(String id, String fiscalCode, String patientName, BigDecimal total, BigDecimal exempt, BigDecimal copay, String exemptionCodes, LocalDateTime now) {
        Receipt r = new Receipt();
        r.id = id;
        r.fiscalCode = fiscalCode;
        r.patientName = patientName;
        r.issuedAt = now;
        r.total = total;
        r.exempt = exempt;
        r.copay = copay;
        r.exemptionCodes = exemptionCodes;
        r.status = EMESSA;
        return r;
    }

    void pay(LocalDateTime at) {
        if (!EMESSA.equals(status)) throw new ConflictException("status: only a receipt " + EMESSA + " can be paid (" + id + " is " + status + ")");
        status = PAGATA;
        paidAt = at;
    }

    void storno() {
        if (!EMESSA.equals(status)) throw new ConflictException("status: only an unpaid receipt can be cancelled (" + id + " is " + status + ")");
        status = STORNATA;
    }

    public String getId() { return id; }
    public String getFiscalCode() { return fiscalCode; }
    public String getPatientName() { return patientName; }
    public LocalDateTime getIssuedAt() { return issuedAt; }
    public BigDecimal getTotal() { return total; }
    public BigDecimal getExempt() { return exempt; }
    public BigDecimal getCopay() { return copay; }
    public String getExemptionCodes() { return exemptionCodes; }
    public String getStatus() { return status; }
    public LocalDateTime getPaidAt() { return paidAt; }
}
