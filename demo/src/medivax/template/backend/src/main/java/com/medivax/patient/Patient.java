package com.medivax.patient;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;

@Entity
@Table(name = "patients")
public class Patient {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "fiscal_code", nullable = false, unique = true, length = 16)
    private String fiscalCode;

    @Column(name = "last_name", nullable = false)
    private String lastName;

    @Column(name = "first_name", nullable = false)
    private String firstName;

    /** "M" or "F". */
    @Column(nullable = false, length = 1)
    private String sex;

    @Column(name = "birth_date", nullable = false)
    private LocalDate birthDate;

    @Column(name = "birth_place", nullable = false)
    private String birthPlace;

    private String phone;

    @Column(name = "health_card")
    private String healthCard;

    protected Patient() {}

    public Patient(String fiscalCode, String lastName, String firstName, String sex, LocalDate birthDate, String birthPlace) {
        this.fiscalCode = fiscalCode;
        this.lastName = lastName;
        this.firstName = firstName;
        this.sex = sex;
        this.birthDate = birthDate;
        this.birthPlace = birthPlace;
    }

    public Long getId() { return id; }
    public String getFiscalCode() { return fiscalCode; }
    public String getLastName() { return lastName; }
    public String getFirstName() { return firstName; }
    public String getSex() { return sex; }
    public LocalDate getBirthDate() { return birthDate; }
    public String getBirthPlace() { return birthPlace; }
    public String getPhone() { return phone; }
    public String getHealthCard() { return healthCard; }

    /** "Rossi Mario": surname first, as the centre's lists show it. */
    public String displayName() {
        return lastName + " " + firstName;
    }
}
