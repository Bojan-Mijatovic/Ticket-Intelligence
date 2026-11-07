package com.medifarma.prescription;

import com.medifarma.common.ConflictException;
import com.medifarma.common.NotFoundException;
import com.medifarma.drug.Drug;
import com.medifarma.drug.DrugRepository;
import com.medifarma.integration.PatientInfo;
import com.medifarma.safety.SafetyCheck;
import com.medifarma.safety.SafetyService;
import com.medifarma.safety.Warning;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Prescriptions: issued after the checks (ALTA warnings acknowledged), dispensed by the pharmacy, or cancelled. */
@Service
public class PrescriptionService {

    private final PrescriptionRepository prescriptions;
    private final DrugRepository drugs;
    private final SafetyService safety;

    public PrescriptionService(PrescriptionRepository prescriptions, DrugRepository drugs, SafetyService safety) {
        this.prescriptions = prescriptions;
        this.drugs = drugs;
        this.safety = safety;
    }

    @Transactional
    public PrescriptionView issue(PrescriptionRequest request) {
        PatientInfo patient = safety.patient(request.patientId());
        List<Drug> list = safety.drugs(request.items().stream().map(PrescriptionRequest.Item::aic).toList());
        SafetyCheck check = safety.check(patient, list);
        List<Warning> high = check.warnings().stream().filter(Warning::isHigh).toList();
        if (!high.isEmpty() && !request.acknowledgeWarnings()) {
            throw new ConflictException("warnings: " + high.size() + " high warning(s) to acknowledge: "
                    + high.stream().map(w -> w.drug() + " (" + w.message() + ")").collect(Collectors.joining("; ")));
        }
        LocalDateTime now = LocalDateTime.now();
        String id = String.format("RX-%d-%05d", now.getYear(), prescriptions.nextNumber());
        List<PrescriptionItem> items = request.items().stream()
                .map(i -> new PrescriptionItem(i.aic(), i.dose().trim(), i.frequency().trim(), i.days(), i.packs()))
                .toList();
        return view(prescriptions.save(Prescription.issue(id, patient, request.prescriber(), items, check.egfr(), !high.isEmpty(), now)));
    }

    @Transactional(readOnly = true)
    public List<PrescriptionView> list(String status) {
        return prescriptions.findAllByOrderByIssuedAtDesc().stream()
                .filter(p -> status == null || status.isBlank() || status.equalsIgnoreCase(p.getStatus()))
                .map(this::view)
                .toList();
    }

    @Transactional(readOnly = true)
    public PrescriptionView get(String id) {
        return view(find(id));
    }

    @Transactional
    public PrescriptionView cancel(String id) {
        Prescription p = find(id);
        p.cancel();
        return view(p);
    }

    public Prescription find(String id) {
        return prescriptions.findById(id).orElseThrow(() -> new NotFoundException("Prescription", id));
    }

    public PrescriptionView view(Prescription p) {
        Map<String, Drug> byAic = drugs.findAllById(p.getItems().stream().map(PrescriptionItem::getAic).toList()).stream()
                .collect(Collectors.toMap(Drug::getAic, Function.identity()));
        List<PrescriptionView.Item> items = p.getItems().stream()
                .map(i -> new PrescriptionView.Item(i.getAic(), byAic.get(i.getAic()).getName(), i.getDose(), i.getFrequency(), i.getDays(), i.getPacks()))
                .toList();
        return new PrescriptionView(p.getId(), p.getPatientId(), p.getFiscalCode(), p.getPatientName(), p.getSex(), p.getBirthDate(),
                p.getPrescriber(), p.getStatus(), p.getIssuedAt(), p.getEgfr(), p.isWarningsAcknowledged(), items);
    }
}
