package com.mediagenda.resource;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** A provider ("erogatore") inside a structure, e.g. CA_CARDIOLOGIA. Shown in the "Risorse" list. */
@Entity
@Table(name = "resources")
public class AgendaResource {

    @Id
    private String code;
    private String description;
    @Column(name = "structure_id")
    private String structureId;
    private boolean active;

    protected AgendaResource() {}

    public String getCode() { return code; }
    public String getDescription() { return description; }
    public String getStructureId() { return structureId; }
    public boolean isActive() { return active; }
}
