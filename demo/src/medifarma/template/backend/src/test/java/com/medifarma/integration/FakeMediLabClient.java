package com.medifarma.integration;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/**
 * MediLab for the tests: the latest validated creatinine of some patients of the MediAgenda seed, no HTTP.
 * A test can put its own value with {@link #creatinine}; {@link #reset()} restores the defaults.
 */
@Component
@Primary
public class FakeMediLabClient implements MediLabClient {

    public final Map<String, LabValue> creatinine = new HashMap<>();

    public FakeMediLabClient() {
        reset();
    }

    /** Marino Paolo: 221 µmol/L (renal impairment, eGFR about 28); Rossi Mario: 88 µmol/L (normal). */
    public void reset() {
        creatinine.clear();
        creatinine.put("MRNPLA61S03C351V", new LabValue(new BigDecimal("221"), "µmol/L", LocalDateTime.of(2026, 11, 3, 14, 5), "RL-2026-00052"));
        creatinine.put("RSSMRA80A01F205X", new LabValue(new BigDecimal("88"), "µmol/L", LocalDateTime.of(2026, 10, 5, 13, 20), "RL-2026-00041"));
    }

    @Override
    public Optional<LabValue> latestCreatinine(String fiscalCode) {
        return Optional.ofNullable(creatinine.get(fiscalCode));
    }
}
