package com.medifarma.dispensing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.medifarma.common.ConflictException;
import com.medifarma.prescription.Prescription;
import com.medifarma.prescription.PrescriptionRequest;
import com.medifarma.prescription.PrescriptionService;
import com.medifarma.stock.LotRepository;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class DispensingServiceTest {

    @Autowired
    DispensingService service;

    @Autowired
    PrescriptionService prescriptions;

    @Autowired
    LotRepository lots;

    private String prescribe(String aic, int packs) {
        return prescriptions.issue(new PrescriptionRequest(1L, "Dr. Marco Fumagalli", false,
                List.of(new PrescriptionRequest.Item(aic, "1 compressa", "1 volta al giorno", 30, packs)))).id();
    }

    private int stock(String lotNumber) {
        return lots.findAll().stream().filter(l -> l.getLotNumber().equals(lotNumber)).findFirst().orElseThrow().getQuantity();
    }

    @Test
    void takesTheLotThatExpiresFirst() {
        // Enoxaparina: L-EN2603 (8 packs, December) before L-EN2608.
        DispensingView d = service.dispense("RX-2026-00036");
        assertThat(d.lines()).extracting(DispensingView.Line::lotNumber, DispensingView.Line::packs)
                .containsExactly(org.assertj.core.groups.Tuple.tuple("L-EN2603", 1));
        assertThat(prescriptions.get("RX-2026-00036").status()).isEqualTo(Prescription.DISPENSATA);
    }

    @Test
    void neverUsesAnExpiredLot() {
        // Metformina: L-MF2601 expired on 2026-10-31.
        DispensingView d = service.dispense(prescribe("012345016", 2));
        assertThat(d.lines()).extracting(DispensingView.Line::lotNumber).containsExactly("L-MF2604");
        assertThat(stock("L-MF2601")).isEqualTo(6);
    }

    @Test
    void notEnoughPacksIsAConflictAndNothingIsHandedOut() {
        // Amoxicillina: 3 packs in stock.
        String id = prescribe("045678012", 5);
        assertThatThrownBy(() -> service.dispense(id)).isInstanceOf(ConflictException.class).hasMessageContaining("3 of 5");
    }

    @Test
    void aPrescriptionIsDispensedOnce() {
        service.dispense("RX-2026-00031");
        assertThatThrownBy(() -> service.dispense("RX-2026-00031")).isInstanceOf(ConflictException.class);
    }
}
