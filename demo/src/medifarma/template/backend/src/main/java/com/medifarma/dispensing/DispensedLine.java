package com.medifarma.dispensing;

import jakarta.persistence.Column;
import jakarta.persistence.Embeddable;

/** Packs of one lot handed out for a prescription. */
@Embeddable
public class DispensedLine {

    private String aic;
    @Column(name = "lot_number")
    private String lotNumber;
    private int packs;

    protected DispensedLine() {}

    DispensedLine(String aic, String lotNumber, int packs) {
        this.aic = aic;
        this.lotNumber = lotNumber;
        this.packs = packs;
    }

    public String getAic() { return aic; }
    public String getLotNumber() { return lotNumber; }
    public int getPacks() { return packs; }
}
