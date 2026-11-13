package com.medivax.dose;

import com.medivax.common.Ages;
import com.medivax.common.BadRequestException;
import com.medivax.common.ConflictException;
import com.medivax.lot.Lot;
import com.medivax.lot.LotRepository;
import com.medivax.patient.Patient;
import com.medivax.patient.PatientService;
import com.medivax.schedule.Schedule;
import com.medivax.schedule.Schedule.NextDose;
import com.medivax.vaccine.Vaccine;
import com.medivax.vaccine.VaccineRepository;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class DoseService {

    private final DoseRepository doses;
    private final VaccineRepository vaccines;
    private final LotRepository lots;
    private final PatientService patients;

    public DoseService(DoseRepository doses, VaccineRepository vaccines, LotRepository lots, PatientService patients) {
        this.doses = doses;
        this.vaccines = vaccines;
        this.lots = lots;
        this.patients = patients;
    }

    /**
     * Records a dose after the checks the nurse would make: the lot is of that vaccine, not expired on the day and not
     * empty; the patient is in the vaccine's age range; and the dose is not given before its interval (or after a
     * complete series without a booster). The lot loses one dose.
     */
    @Transactional
    public DoseView record(DoseRequest request) {
        Patient patient = patients.get(request.patientId());
        Vaccine vaccine = vaccines.findById(request.vaccineCode())
                .orElseThrow(() -> new BadRequestException("vaccineCode: unknown vaccine " + request.vaccineCode()));
        Lot lot = lots.findById(request.lotCode())
                .orElseThrow(() -> new BadRequestException("lotCode: unknown lot " + request.lotCode()));
        if (!lot.getVaccineCode().equals(vaccine.getCode())) {
            throw new BadRequestException("lotCode: lot " + lot.getCode() + " is not a lot of " + vaccine.getCode());
        }
        if (!lot.usableOn(request.givenOn())) {
            throw new ConflictException("lotCode: lot " + lot.getCode() + " expired on " + Ages.italian(lot.getExpiry()));
        }
        if (lot.getDosesLeft() <= 0) {
            throw new ConflictException("lotCode: lot " + lot.getCode() + " has no doses left");
        }

        int months = Ages.months(patient.getBirthDate(), request.givenOn());
        if (months < vaccine.getMinAgeMonths()) {
            throw new ConflictException("age: " + vaccine.getCode() + " is given from " + vaccine.getMinAgeMonths() + " months, the patient is " + months + " months old");
        }
        int years = Ages.years(patient.getBirthDate(), request.givenOn());
        if (vaccine.getMaxAgeYears() != null && years > vaccine.getMaxAgeYears()) {
            throw new ConflictException("age: " + vaccine.getCode() + " is given up to " + vaccine.getMaxAgeYears() + " years, the patient is " + years);
        }

        List<Dose> given = doses.findByPatientIdAndVaccineCodeOrderByDoseNumber(patient.getId(), vaccine.getCode());
        int number = 1;
        if (!given.isEmpty()) {
            Optional<NextDose> next = Schedule.next(vaccine, given);
            if (next.isEmpty()) {
                throw new ConflictException("vaccineCode: the series of " + vaccine.getCode() + " is complete");
            }
            if (request.givenOn().isBefore(next.get().dueOn())) {
                throw new ConflictException("givenOn: dose " + next.get().doseNumber() + " of " + vaccine.getCode() + " not before " + Ages.italian(next.get().dueOn()));
            }
            number = next.get().doseNumber();
        }

        Dose dose = doses.save(new Dose(patient.getId(), vaccine.getCode(), number, request.givenOn(), lot.getCode()));
        lot.takeOne();
        return view(dose, vaccine);
    }

    /** The patient's card: the doses given, oldest first, and the next dose of each vaccine started. */
    @Transactional(readOnly = true)
    public PatientCard card(long patientId) {
        Patient patient = patients.get(patientId);
        Map<String, Vaccine> catalog = catalog();
        List<Dose> given = doses.findByPatientIdOrderByGivenOnAscIdAsc(patientId);
        List<DoseView> views = given.stream().map(d -> view(d, catalog.get(d.getVaccineCode()))).toList();
        return new PatientCard(patient, views, Schedule.nextDoses(given, catalog));
    }

    Map<String, Vaccine> catalog() {
        return vaccines.findAll().stream().collect(Collectors.toMap(Vaccine::getCode, Function.identity()));
    }

    private static DoseView view(Dose d, Vaccine v) {
        return new DoseView(d.getId(), d.getVaccineCode(), v == null ? d.getVaccineCode() : v.getName(), d.getDoseNumber(), d.getGivenOn(), d.getLotCode());
    }
}
