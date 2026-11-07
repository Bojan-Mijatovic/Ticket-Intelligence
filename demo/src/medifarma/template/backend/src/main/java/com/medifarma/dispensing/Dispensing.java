package com.medifarma.dispensing;

import jakarta.persistence.CollectionTable;
import jakarta.persistence.Column;
import jakarta.persistence.ElementCollection;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OrderColumn;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/** The pharmacy handed out a prescription: which lots, how many packs, when. */
@Entity
@Table(name = "dispensings")
public class Dispensing {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "dispensing_seq")
    @SequenceGenerator(name = "dispensing_seq", sequenceName = "dispensing_seq", allocationSize = 1)
    private Long id;
    @Column(name = "prescription_id")
    private String prescriptionId;
    @Column(name = "dispensed_at")
    private LocalDateTime dispensedAt;

    @ElementCollection(fetch = FetchType.EAGER)
    @CollectionTable(name = "dispensing_lines", joinColumns = @JoinColumn(name = "dispensing_id"))
    @OrderColumn(name = "line_no")
    private List<DispensedLine> lines = new ArrayList<>();

    protected Dispensing() {}

    Dispensing(String prescriptionId, List<DispensedLine> lines, LocalDateTime at) {
        this.prescriptionId = prescriptionId;
        this.lines = new ArrayList<>(lines);
        this.dispensedAt = at;
    }

    public Long getId() { return id; }
    public String getPrescriptionId() { return prescriptionId; }
    public LocalDateTime getDispensedAt() { return dispensedAt; }
    public List<DispensedLine> getLines() { return lines; }
}
