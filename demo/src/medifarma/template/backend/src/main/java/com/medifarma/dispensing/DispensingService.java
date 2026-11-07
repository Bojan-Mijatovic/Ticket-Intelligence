package com.medifarma.dispensing;

import com.medifarma.common.ConflictException;
import com.medifarma.common.NotFoundException;
import com.medifarma.drug.Drug;
import com.medifarma.drug.DrugRepository;
import com.medifarma.prescription.Prescription;
import com.medifarma.prescription.PrescriptionItem;
import com.medifarma.prescription.PrescriptionService;
import com.medifarma.stock.Lot;
import com.medifarma.stock.LotRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Hands out a prescription from stock, lot by lot in FEFO order (first expired, first out). Expired lots are never
 * used. All or nothing: when a drug has too few packs, no lot is touched.
 */
@Service
public class DispensingService {

    private final DispensingRepository dispensings;
    private final PrescriptionService prescriptions;
    private final LotRepository lots;
    private final DrugRepository drugs;

    public DispensingService(DispensingRepository dispensings, PrescriptionService prescriptions, LotRepository lots, DrugRepository drugs) {
        this.dispensings = dispensings;
        this.prescriptions = prescriptions;
        this.lots = lots;
        this.drugs = drugs;
    }

    @Transactional
    public DispensingView dispense(String prescriptionId) {
        Prescription rx = prescriptions.find(prescriptionId);
        if (!Prescription.EMESSA.equals(rx.getStatus())) {
            throw new ConflictException("status: prescription " + prescriptionId + " is " + rx.getStatus() + ", not " + Prescription.EMESSA);
        }
        LocalDate today = LocalDate.now();
        List<DispensedLine> lines = new ArrayList<>();
        for (PrescriptionItem item : rx.getItems()) {
            int missing = item.getPacks();
            List<Lot> usable = lots.findByAicOrderByExpiryAscIdAsc(item.getAic()).stream()
                    .filter(l -> !l.isExpiredOn(today))
                    .filter(l -> l.getQuantity() > 0)
                    .toList();
            for (Lot lot : usable) {
                if (missing == 0) break;
                int packs = Math.min(missing, lot.getQuantity());
                lot.take(packs);
                lots.save(lot);
                lines.add(new DispensedLine(item.getAic(), lot.getLotNumber(), packs));
                missing -= packs;
            }
            if (missing > 0) {
                throw new ConflictException("stock: not enough packs of " + drug(item.getAic()).getName() + " (" + (item.getPacks() - missing) + " of " + item.getPacks() + ")");
            }
        }
        rx.dispensed();
        return view(dispensings.save(new Dispensing(prescriptionId, lines, LocalDateTime.now())), rx);
    }

    @Transactional(readOnly = true)
    public List<DispensingView> ofPrescription(String prescriptionId) {
        Prescription rx = prescriptions.find(prescriptionId);
        return dispensings.findByPrescriptionId(prescriptionId).stream().map(d -> view(d, rx)).toList();
    }

    private Drug drug(String aic) {
        return drugs.findById(aic).orElseThrow(() -> new NotFoundException("Drug", aic));
    }

    private DispensingView view(Dispensing d, Prescription rx) {
        List<DispensingView.Line> lines = d.getLines().stream()
                .map(l -> new DispensingView.Line(l.getAic(), drug(l.getAic()).getName(), l.getLotNumber(),
                        lots.findByAicOrderByExpiryAscIdAsc(l.getAic()).stream().filter(x -> x.getLotNumber().equals(l.getLotNumber())).map(Lot::getExpiry).findFirst().orElse(null),
                        l.getPacks()))
                .toList();
        return new DispensingView(d.getId(), d.getPrescriptionId(), rx.getPatientName(), d.getDispensedAt(), lines);
    }
}
