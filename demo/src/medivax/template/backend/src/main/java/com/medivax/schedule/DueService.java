package com.medivax.schedule;

import com.medivax.common.BadRequestException;
import com.medivax.dose.Dose;
import com.medivax.dose.DoseRepository;
import com.medivax.patient.Patient;
import com.medivax.patient.PatientRepository;
import com.medivax.schedule.Schedule.NextDose;
import com.medivax.vaccine.Vaccine;
import com.medivax.vaccine.VaccineRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DueService {

    /** A dose due in a period, for the call list of the week. */
    public record DueRow(Long patientId, String patientName, String fiscalCode, String phone, String vaccineCode, String vaccineName, int doseNumber, LocalDate dueOn, boolean booster) {}

    private final DoseRepository doses;
    private final PatientRepository patients;
    private final VaccineRepository vaccines;

    public DueService(DoseRepository doses, PatientRepository patients, VaccineRepository vaccines) {
        this.doses = doses;
        this.patients = patients;
        this.vaccines = vaccines;
    }

    /** The next doses due from `from` to `to`, both included, the earliest first. */
    @Transactional(readOnly = true)
    public List<DueRow> due(LocalDate from, LocalDate to) {
        if (to.isBefore(from)) throw new BadRequestException("to: before from");
        Map<String, Vaccine> catalog = vaccines.findAll().stream().collect(Collectors.toMap(Vaccine::getCode, Function.identity()));
        Map<Long, List<Dose>> byPatient = doses.findAll().stream().collect(Collectors.groupingBy(Dose::getPatientId));
        Map<Long, Patient> people = patients.findAllById(byPatient.keySet()).stream().collect(Collectors.toMap(Patient::getId, Function.identity()));
        List<DueRow> out = new ArrayList<>();
        for (Map.Entry<Long, List<Dose>> e : byPatient.entrySet()) {
            Patient p = people.get(e.getKey());
            for (NextDose n : Schedule.nextDoses(e.getValue(), catalog)) {
                if (!n.dueOn().isBefore(from) && !n.dueOn().isAfter(to)) {
                    out.add(new DueRow(p.getId(), p.displayName(), p.getFiscalCode(), p.getPhone(), n.vaccineCode(), n.vaccineName(), n.doseNumber(), n.dueOn(), n.booster()));
                }
            }
        }
        out.sort(Comparator.comparing(DueRow::dueOn).thenComparing(DueRow::patientName));
        return out;
    }
}
