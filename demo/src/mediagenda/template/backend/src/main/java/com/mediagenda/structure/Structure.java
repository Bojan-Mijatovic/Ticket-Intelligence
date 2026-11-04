package com.mediagenda.structure;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** A healthcare facility ("Struttura"). The id is the structure code, e.g. SVIL_MS_VISITE. */
@Entity
@Table(name = "structures")
public class Structure {

    @Id
    private String id;
    private String name;
    private String city;

    protected Structure() {}

    public String getId() { return id; }
    public String getName() { return name; }
    public String getCity() { return city; }
}
