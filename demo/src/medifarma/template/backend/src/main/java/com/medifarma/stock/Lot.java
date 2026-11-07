package com.medifarma.stock;

import com.medifarma.common.ConflictException;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;

/** A lot of a drug in the pharmacy stock: lot number, expiry date and the packs left. */
@Entity
@Table(name = "lots")
public class Lot {

    @Id
    private Long id;
    private String aic;
    @Column(name = "lot_number")
    private String lotNumber;
    private LocalDate expiry;
    private int quantity;

    protected Lot() {}

    public boolean isExpiredOn(LocalDate day) {
        return expiry.isBefore(day);
    }

    /** Takes `packs` packs out of this lot. */
    public void take(int packs) {
        if (packs > quantity) throw new ConflictException("stock: lot " + lotNumber + " has " + quantity + " packs, not " + packs);
        quantity -= packs;
    }

    public Long getId() { return id; }
    public String getAic() { return aic; }
    public String getLotNumber() { return lotNumber; }
    public LocalDate getExpiry() { return expiry; }
    public int getQuantity() { return quantity; }
}
