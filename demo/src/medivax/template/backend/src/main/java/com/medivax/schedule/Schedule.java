package com.medivax.schedule;

import com.medivax.dose.Dose;
import com.medivax.vaccine.Vaccine;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

/** When the next dose of a vaccine is due, from the doses given so far. */
public final class Schedule {

    /** The next dose of a vaccine: its number, the first day it can be given, and whether it is a booster. */
    public record NextDose(String vaccineCode, String vaccineName, int doseNumber, LocalDate dueOn, boolean booster) {}

    private Schedule() {}

    /**
     * The next dose of `vaccine` after `given` (that vaccine's doses of one patient). Inside the primary series it is
     * due `intervalDays` after the last dose; after the series, the booster is due `boosterMonths` after it. Empty when
     * nothing was given yet, or the series is complete and the vaccine has no booster.
     */
    public static Optional<NextDose> next(Vaccine vaccine, List<Dose> given) {
        if (given.isEmpty()) return Optional.empty();
        Dose last = given.stream().max(Comparator.comparing(Dose::getGivenOn).thenComparing(Dose::getDoseNumber)).orElseThrow();
        int count = given.stream().mapToInt(Dose::getDoseNumber).max().orElse(0);
        if (count < vaccine.getDoses()) {
            return Optional.of(new NextDose(vaccine.getCode(), vaccine.getName(), count + 1, last.getGivenOn().plusDays(vaccine.getIntervalDays()), false));
        }
        if (vaccine.getBoosterMonths() != null) {
            return Optional.of(new NextDose(vaccine.getCode(), vaccine.getName(), count + 1, last.getGivenOn().plusMonths(vaccine.getBoosterMonths()), true));
        }
        return Optional.empty();
    }

    /** The next dose of every vaccine a patient has started, the earliest first. */
    public static List<NextDose> nextDoses(List<Dose> doses, Map<String, Vaccine> catalog) {
        Map<String, List<Dose>> byVaccine = doses.stream().collect(Collectors.groupingBy(Dose::getVaccineCode));
        List<NextDose> out = new ArrayList<>();
        for (Map.Entry<String, List<Dose>> e : byVaccine.entrySet()) {
            Vaccine v = catalog.get(e.getKey());
            if (v != null) next(v, e.getValue()).ifPresent(out::add);
        }
        out.sort(Comparator.comparing(NextDose::dueOn).thenComparing(NextDose::vaccineCode));
        return out;
    }
}
