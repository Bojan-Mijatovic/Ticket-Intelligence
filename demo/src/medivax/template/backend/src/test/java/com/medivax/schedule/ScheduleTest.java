package com.medivax.schedule;

import static org.assertj.core.api.Assertions.assertThat;

import com.medivax.dose.Dose;
import com.medivax.schedule.Schedule.NextDose;
import com.medivax.vaccine.Vaccine;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class ScheduleTest {

    private static final Vaccine ESA = new Vaccine("ESA", "Esavalente", 3, 60, 2, 6, null);
    private static final Vaccine INFL = new Vaccine("INFL", "Antinfluenzale", 1, 0, 6, null, 12);

    private static Dose dose(String vaccine, int n, LocalDate on) {
        return new Dose(1L, vaccine, n, on, "LOT");
    }

    @Test
    void theNextDoseOfASeriesIsDueAfterTheInterval() {
        NextDose next = Schedule.next(ESA, List.of(dose("ESA", 1, LocalDate.of(2026, 3, 2)))).orElseThrow();
        assertThat(next.doseNumber()).isEqualTo(2);
        assertThat(next.dueOn()).isEqualTo(LocalDate.of(2026, 5, 1));
        assertThat(next.booster()).isFalse();
    }

    @Test
    void aCompleteSeriesWithoutBoosterHasNoNextDose() {
        List<Dose> all = List.of(dose("ESA", 1, LocalDate.of(2026, 1, 5)), dose("ESA", 2, LocalDate.of(2026, 3, 6)), dose("ESA", 3, LocalDate.of(2026, 5, 5)));
        assertThat(Schedule.next(ESA, all)).isEmpty();
    }

    @Test
    void theBoosterIsDueMonthsAfterTheLastDose() {
        NextDose next = Schedule.next(INFL, List.of(dose("INFL", 1, LocalDate.of(2025, 10, 20)))).orElseThrow();
        assertThat(next.booster()).isTrue();
        assertThat(next.doseNumber()).isEqualTo(2);
        assertThat(next.dueOn()).isEqualTo(LocalDate.of(2026, 10, 20));
    }

    @Test
    void nextDosesAreSortedByDay() {
        List<NextDose> next = Schedule.nextDoses(List.of(dose("INFL", 1, LocalDate.of(2025, 10, 20)), dose("ESA", 1, LocalDate.of(2026, 3, 2))), Map.of("ESA", ESA, "INFL", INFL));
        assertThat(next).extracting(NextDose::vaccineCode).containsExactly("ESA", "INFL");
    }
}
