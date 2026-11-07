package com.medifarma.prescription;

import com.medifarma.common.BadRequestException;
import com.medifarma.common.NotFoundException;
import com.medifarma.drug.Drug;
import com.medifarma.drug.DrugRepository;
import com.medifarma.integration.MediAgendaClient;
import com.medifarma.integration.PatientInfo;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Prescriptions for MediAgenda patients: issued, dispensed by the pharmacy, or cancelled. */
@Service
public class PrescriptionService {

    private final PrescriptionRepository prescriptions;
    private final DrugRepository drugs;
    private final MediAgendaClient mediAgenda;

    public PrescriptionService(PrescriptionRepository prescriptions, DrugRepository drugs, MediAgendaClient mediAgenda) {
        this.prescriptions = prescriptions;
        this.drugs = drugs;
        this.mediAgenda = mediAgenda;
    }

    @Transactional
    public PrescriptionView issue(PrescriptionRequest request) {
        PatientInfo patient = mediAgenda.patient(request.patientId())
                .orElseThrow(() -> new BadRequestException("patientId: patient " + request.patientId() + " is not in the MediAgenda registry"));
        for (PrescriptionRequest.Item i : request.items()) {
            drugs.findById(i.aic()).filter(Drug::isActive).orElseThrow(() -> new BadRequestException("aic: " + i.aic() + " is not in the formulary"));
        }
        LocalDateTime now = LocalDateTime.now();
        String id = String.format("RX-%d-%05d", now.getYear(), prescriptions.nextNumber());
        List<PrescriptionItem> items = request.items().stream()
                .map(i -> new PrescriptionItem(i.aic(), i.dose().trim(), i.frequency().trim(), i.days(), i.packs()))
                .toList();
        return view(prescriptions.save(Prescription.issue(id, patient, request.prescriber(), items, now)));
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
                p.getPrescriber(), p.getStatus(), p.getIssuedAt(), items);
    }
}
