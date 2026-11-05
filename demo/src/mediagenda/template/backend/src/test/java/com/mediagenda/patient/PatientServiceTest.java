package com.mediagenda.patient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.mediagenda.common.ConflictException;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class PatientServiceTest {

    @Autowired
    PatientService service;

    private static PatientRequest request(String fiscalCode, String lastName) {
        return new PatientRequest(fiscalCode, "Anna", lastName, LocalDate.of(1991, 6, 14), "F", "Milano", "+39 333 1234567", "anna@example.com");
    }

    @Test
    void createsAPatientWithAnUppercaseFiscalCode() {
        Patient p = service.create(request("nrianb91h54f205u", "Neri"));
        assertThat(p.getId()).isNotNull();
        assertThat(p.getFiscalCode()).isEqualTo("NRIANB91H54F205U");
        assertThat(service.get(p.getId()).getLastName()).isEqualTo("Neri");
    }

    @Test
    void rejectsAFiscalCodeThatIsAlreadyRegistered() {
        assertThatThrownBy(() -> service.create(request("RSSMRA80A01F205X", "Rossi")))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("already registered");
    }

    @Test
    void updatesContactsAndKeepsTheId() {
        Patient p = service.create(request("NRIANB91H54F205U", "Neri"));
        Patient updated = service.update(p.getId(), new PatientRequest("NRIANB91H54F205U", "Anna", "Neri Bassi",
                LocalDate.of(1991, 6, 14), "F", "Lodi", "", "anna.neri@example.com"));
        assertThat(updated.getId()).isEqualTo(p.getId());
        assertThat(updated.getLastName()).isEqualTo("Neri Bassi");
        assertThat(updated.getCity()).isEqualTo("Lodi");
    }
}
