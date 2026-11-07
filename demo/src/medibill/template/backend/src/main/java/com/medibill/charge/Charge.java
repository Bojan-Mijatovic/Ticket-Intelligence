package com.medibill.charge;

import com.medibill.tariff.Tariff;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * A service to charge ("addebito"): a MediAgenda visit (source VISITA, sourceRef = booking id) or a MediLab test
 * (LABORATORIO, sourceRef = request id/test code), at the tariff price. APERTO until it goes on a receipt.
 */
@Entity
@Table(name = "charges")
public class Charge {

    public static final String APERTO = "APERTO";
    public static final String IN_RICEVUTA = "IN_RICEVUTA";

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "charge_seq")
    @SequenceGenerator(name = "charge_seq", sequenceName = "charge_seq", allocationSize = 1)
    private Long id;
    private String source;
    @Column(name = "source_ref")
    private String sourceRef;
    @Column(name = "service_date")
    private LocalDate serviceDate;
    @Column(name = "fiscal_code")
    private String fiscalCode;
    @Column(name = "patient_name")
    private String patientName;
    @Column(name = "tariff_code")
    private String tariffCode;
    private String description;
    private BigDecimal amount;
    private String status;
    @Column(name = "receipt_id")
    private String receiptId;

    protected Charge() {}

    static Charge of(String source, String sourceRef, LocalDate day, String fiscalCode, String patientName, Tariff tariff) {
        Charge c = new Charge();
        c.source = source;
        c.sourceRef = sourceRef;
        c.serviceDate = day;
        c.fiscalCode = fiscalCode.toUpperCase();
        c.patientName = patientName;
        c.tariffCode = tariff.getCode();
        c.description = tariff.getDescription();
        c.amount = tariff.getPrice();
        c.status = APERTO;
        return c;
    }

    public void putOn(String receipt) {
        status = IN_RICEVUTA;
        receiptId = receipt;
    }

    public void release() {
        status = APERTO;
        receiptId = null;
    }

    public Long getId() { return id; }
    public String getSource() { return source; }
    public String getSourceRef() { return sourceRef; }
    public LocalDate getServiceDate() { return serviceDate; }
    public String getFiscalCode() { return fiscalCode; }
    public String getPatientName() { return patientName; }
    public String getTariffCode() { return tariffCode; }
    public String getDescription() { return description; }
    public BigDecimal getAmount() { return amount; }
    public String getStatus() { return status; }
    public String getReceiptId() { return receiptId; }
}
