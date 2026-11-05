package com.mediagenda.patient;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import java.time.LocalDate;

@Entity
@Table(name = "patients")
public class Patient {

    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "patient_seq")
    @SequenceGenerator(name = "patient_seq", sequenceName = "patient_seq", allocationSize = 1)
    private Long id;
    @Column(name = "fiscal_code")
    private String fiscalCode;
    @Column(name = "first_name")
    private String firstName;
    @Column(name = "last_name")
    private String lastName;
    @Column(name = "birth_date")
    private LocalDate birthDate;
    private String sex;
    private String city;
    private String phone;
    private String email;

    protected Patient() {}

    static Patient from(PatientRequest request) {
        Patient p = new Patient();
        p.apply(request);
        return p;
    }

    void apply(PatientRequest r) {
        this.fiscalCode = r.fiscalCode().toUpperCase();
        this.firstName = r.firstName().trim();
        this.lastName = r.lastName().trim();
        this.birthDate = r.birthDate();
        this.sex = r.sex();
        this.city = r.city();
        this.phone = r.phone();
        this.email = r.email();
    }

    public Long getId() { return id; }
    public String getFiscalCode() { return fiscalCode; }
    public String getFirstName() { return firstName; }
    public String getLastName() { return lastName; }
    public LocalDate getBirthDate() { return birthDate; }
    public String getSex() { return sex; }
    public String getCity() { return city; }
    public String getPhone() { return phone; }
    public String getEmail() { return email; }
}
