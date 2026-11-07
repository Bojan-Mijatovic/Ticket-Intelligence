package com.medibill.tariff;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;

/**
 * A service of the regional fee schedule ("nomenclatore tariffario"): a visit of a MediAgenda provider
 * (mediagendaResource = its resource code) or a laboratory test (the tariff code of the MediLab catalog).
 */
@Entity
@Table(name = "tariffs")
public class Tariff {

    public static final String VISITA = "VISITA";
    public static final String LABORATORIO = "LABORATORIO";

    @Id
    private String code;
    private String description;
    private String kind;
    private BigDecimal price;
    @Column(name = "mediagenda_resource")
    private String mediagendaResource;
    private boolean active;

    protected Tariff() {}

    public String getCode() { return code; }
    public String getDescription() { return description; }
    public String getKind() { return kind; }
    public BigDecimal getPrice() { return price; }
    public String getMediagendaResource() { return mediagendaResource; }
    public boolean isActive() { return active; }
}
