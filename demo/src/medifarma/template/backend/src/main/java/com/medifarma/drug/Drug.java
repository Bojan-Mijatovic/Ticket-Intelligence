package com.medifarma.drug;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;

/**
 * A medicinal product of the hospital formulary, identified by its AIC code (the Italian marketing authorisation).
 * Drugs cleared by the kidneys carry a renal rule: reduce the dose below an eGFR, avoid it below another.
 */
@Entity
@Table(name = "drugs")
public class Drug {

    @Id
    private String aic;
    private String name;
    @Column(name = "active_ingredient")
    private String activeIngredient;
    private String atc;
    @Column(name = "pack_size")
    private int packSize;
    @Column(name = "unit_price")
    private BigDecimal unitPrice;
    @Column(name = "min_stock")
    private int minStock;
    private boolean active;
    @Column(name = "renal_reduce_below")
    private Integer renalReduceBelow;
    @Column(name = "renal_avoid_below")
    private Integer renalAvoidBelow;
    @Column(name = "renal_note")
    private String renalNote;

    protected Drug() {}

    public String getAic() { return aic; }
    public String getName() { return name; }
    public String getActiveIngredient() { return activeIngredient; }
    public String getAtc() { return atc; }
    public int getPackSize() { return packSize; }
    public BigDecimal getUnitPrice() { return unitPrice; }
    public int getMinStock() { return minStock; }
    public boolean isActive() { return active; }
    public Integer getRenalReduceBelow() { return renalReduceBelow; }
    public Integer getRenalAvoidBelow() { return renalAvoidBelow; }
    public String getRenalNote() { return renalNote; }
}
