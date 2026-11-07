package com.medifarma.safety;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class RenalFunctionTest {

    @Test
    void ckdEpi2021ForAManAndAWoman() {
        // Reference values of the CKD-EPI 2021 equation.
        assertThat(RenalFunction.egfr(1.0, 50, "M")).isEqualTo(92);
        assertThat(RenalFunction.egfr(1.0, 50, "F")).isEqualTo(69);
        assertThat(RenalFunction.egfr(0.7, 40, "F")).isEqualTo(112);
    }

    @Test
    void impairedKidneyFunction() {
        assertThat(RenalFunction.egfr(2.5, 65, "M")).isBetween(27, 29);
    }
}
