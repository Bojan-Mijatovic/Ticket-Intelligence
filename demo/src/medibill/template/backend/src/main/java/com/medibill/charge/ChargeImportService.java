package com.medibill.charge;

import com.medibill.integration.BookingInfo;
import com.medibill.integration.LabOrderInfo;
import com.medibill.integration.MediAgendaClient;
import com.medibill.integration.MediLabClient;
import com.medibill.tariff.Tariff;
import com.medibill.tariff.TariffRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Daily import of the services to charge: the visits of the day from MediAgenda (tariff by the provider's resource
 * code) and the tests reported that day in MediLab (tariff by the test's tariff code). Importing a day twice adds
 * nothing: every charge remembers its source.
 */
@Service
public class ChargeImportService {

    public static final String VISITA = Tariff.VISITA;
    public static final String LABORATORIO = Tariff.LABORATORIO;

    private final ChargeRepository charges;
    private final TariffRepository tariffs;
    private final MediAgendaClient mediAgenda;
    private final MediLabClient mediLab;

    public ChargeImportService(ChargeRepository charges, TariffRepository tariffs, MediAgendaClient mediAgenda, MediLabClient mediLab) {
        this.charges = charges;
        this.tariffs = tariffs;
        this.mediAgenda = mediAgenda;
        this.mediLab = mediLab;
    }

    @Transactional
    public ImportResult importDay(LocalDate day) {
        int visits = 0;
        int tests = 0;
        int already = 0;
        List<String> skipped = new ArrayList<>();

        // Visits of the day: the MediAgenda bookings with their appointment on that day.
        for (BookingInfo b : mediAgenda.bookings()) {
            if (b.appointmentAt() == null || !b.appointmentAt().toLocalDate().equals(day)) continue;
            if (charges.existsBySourceAndSourceRef(VISITA, b.id())) {
                already++;
                continue;
            }
            Optional<Tariff> tariff = tariffs.findByMediagendaResourceAndActiveTrue(b.resourceCode());
            if (tariff.isEmpty()) {
                skipped.add(b.id() + ": no visit tariff for provider " + b.resourceCode());
                continue;
            }
            charges.save(Charge.of(VISITA, b.id(), day, b.fiscalCode(), b.patientName(), tariff.get()));
            visits++;
        }

        // Tests reported that day in MediLab: one charge per test, by its tariff code.
        for (LabOrderInfo order : mediLab.reportedOrders(day)) {
            for (LabOrderInfo.Exam exam : order.exams()) {
                String ref = order.id() + "/" + exam.code();
                if (charges.existsBySourceAndSourceRef(LABORATORIO, ref)) {
                    already++;
                    continue;
                }
                Optional<Tariff> tariff = tariffs.findById(exam.tariffCode()).filter(Tariff::isActive);
                if (tariff.isEmpty()) {
                    skipped.add(ref + ": tariff " + exam.tariffCode() + " is not in the fee schedule");
                    continue;
                }
                charges.save(Charge.of(LABORATORIO, ref, day, order.fiscalCode(), order.patientName(), tariff.get()));
                tests++;
            }
        }
        return new ImportResult(day, visits, tests, already, skipped);
    }
}
