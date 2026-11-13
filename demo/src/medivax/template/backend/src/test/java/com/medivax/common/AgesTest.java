package com.medivax.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class AgesTest {

    private static final LocalDate BIRTH = LocalDate.of(2010, 6, 15);

    @Test
    void monthsCountWholeMonths() {
        assertThat(Ages.months(LocalDate.of(2026, 1, 10), LocalDate.of(2026, 3, 9))).isEqualTo(1);
        assertThat(Ages.months(LocalDate.of(2026, 1, 10), LocalDate.of(2026, 3, 10))).isEqualTo(2);
    }

    @Test
    void theAgeGoesUpOnTheBirthday() {
        assertThat(Ages.years(BIRTH, LocalDate.of(2026, 6, 14))).isEqualTo(15);
        assertThat(Ages.years(BIRTH, LocalDate.of(2026, 6, 15))).isEqualTo(16);
    }

    @Test
    void datesAreWrittenTheItalianWay() {
        assertThat(Ages.italian(LocalDate.of(2026, 3, 4))).isEqualTo("04/03/2026");
    }
}
