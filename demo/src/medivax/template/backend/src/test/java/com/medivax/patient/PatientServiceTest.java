package com.medivax.patient;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class PatientServiceTest {

    @Autowired
    PatientService service;

    @Autowired
    PatientRepository patients;

    @BeforeEach
    void testPatients() {
        patients.save(new Patient("ZZZTST80A01H501A", "Zanetti", "Prova", "F", LocalDate.of(1980, 1, 1), "Roma"));
        patients.save(new Patient("ZZZTST81B02F205B", "Zanella", "Prova", "M", LocalDate.of(1981, 2, 2), "Milano"));
    }

    @Test
    void findsBySurnameStart() {
        assertThat(service.search("Zan")).extracting(Patient::getLastName).containsExactly("Zanella", "Zanetti");
    }

    @Test
    void findsByFiscalCode() {
        assertThat(service.search("ZZZTST81")).extracting(Patient::getLastName).containsExactly("Zanella");
    }

    @Test
    void oneCharacterFindsNothing() {
        assertThat(service.search("Z")).isEmpty();
    }

    @Test
    void theSearchIgnoresCase() {
        assertThat(service.search("zanetti")).extracting(Patient::getLastName).containsExactly("Zanetti");
        assertThat(service.search("zzztst80")).extracting(Patient::getLastName).containsExactly("Zanetti");
    }
}
