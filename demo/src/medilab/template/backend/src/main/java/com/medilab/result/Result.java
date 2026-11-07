package com.medilab.result;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDateTime;

/** The value of one test of a request, in the unit of the catalog at the time it was entered. */
@Entity
@Table(name = "results")
public class Result {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "result_seq")
    @SequenceGenerator(name = "result_seq", sequenceName = "result_seq", allocationSize = 1)
    private Long id;
    @Column(name = "order_id")
    private String orderId;
    @Column(name = "exam_code")
    private String examCode;
    @Column(name = "result_value")
    private BigDecimal value;
    private String unit;
    private String flag;
    @Column(name = "entered_at")
    private LocalDateTime enteredAt;
    private boolean validated;
    @Column(name = "validated_by")
    private String validatedBy;
    @Column(name = "validated_at")
    private LocalDateTime validatedAt;

    protected Result() {}

    static Result of(String orderId, String examCode) {
        Result r = new Result();
        r.orderId = orderId;
        r.examCode = examCode;
        return r;
    }

    void set(BigDecimal value, String unit, String flag, LocalDateTime at) {
        this.value = value;
        this.unit = unit;
        this.flag = flag;
        this.enteredAt = at;
    }

    void validate(String by, LocalDateTime at) {
        validated = true;
        validatedBy = by;
        validatedAt = at;
    }

    public Long getId() { return id; }
    public String getOrderId() { return orderId; }
    public String getExamCode() { return examCode; }
    public BigDecimal getValue() { return value; }
    public String getUnit() { return unit; }
    public String getFlag() { return flag; }
    public LocalDateTime getEnteredAt() { return enteredAt; }
    public boolean isValidated() { return validated; }
    public String getValidatedBy() { return validatedBy; }
    public LocalDateTime getValidatedAt() { return validatedAt; }
}
