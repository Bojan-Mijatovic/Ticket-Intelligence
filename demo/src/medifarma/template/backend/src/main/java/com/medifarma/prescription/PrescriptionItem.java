package com.medifarma.prescription;

import jakarta.persistence.Embeddable;

/** One drug of a prescription: posology as the prescriber writes it, the days of therapy and the packs to dispense. */
@Embeddable
public class PrescriptionItem {

    private String aic;
    private String dose;
    private String frequency;
    private int days;
    private int packs;

    protected PrescriptionItem() {}

    PrescriptionItem(String aic, String dose, String frequency, int days, int packs) {
        this.aic = aic;
        this.dose = dose;
        this.frequency = frequency;
        this.days = days;
        this.packs = packs;
    }

    public String getAic() { return aic; }
    public String getDose() { return dose; }
    public String getFrequency() { return frequency; }
    public int getDays() { return days; }
    public int getPacks() { return packs; }
}
