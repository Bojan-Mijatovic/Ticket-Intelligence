package com.medibill.exemption;

import com.medibill.common.BadRequestException;
import com.medibill.integration.MediAgendaClient;
import com.medibill.integration.PatientInfo;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ExemptionService {

    private final ExemptionRepository exemptions;
    private final MediAgendaClient mediAgenda;

    public ExemptionService(ExemptionRepository exemptions, MediAgendaClient mediAgenda) {
        this.exemptions = exemptions;
        this.mediAgenda = mediAgenda;
    }

    @Transactional
    public Exemption register(ExemptionRequest request) {
        PatientInfo patient = mediAgenda.patient(request.patientId())
                .orElseThrow(() -> new BadRequestException("patientId: patient " + request.patientId() + " is not in the MediAgenda registry"));
        ExemptionType type = ExemptionType.byCode(request.code()).orElseThrow(() -> new BadRequestException("code: unknown exemption " + request.code()));
        if (request.validTo().isBefore(request.validFrom())) throw new BadRequestException("validTo: before validFrom");
        return exemptions.save(Exemption.of(patient.fiscalCode(), patient.displayName(), type, request.validFrom(), request.validTo()));
    }

    @Transactional(readOnly = true)
    public List<Exemption> list() {
        return exemptions.findAllByOrderByPatientNameAscValidFromDesc();
    }

    /** The exemptions of a patient that are valid on `day` (the day of the service, not the day of the receipt). */
    @Transactional(readOnly = true)
    public List<Exemption> validOn(String fiscalCode, LocalDate day) {
        return exemptions.findByFiscalCodeIgnoreCase(fiscalCode).stream().filter(e -> e.validOn(day)).toList();
    }
}
