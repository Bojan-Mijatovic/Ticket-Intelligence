package com.medibill.charge;

import java.time.LocalDate;
import java.util.List;

/** What the import of a day did: new visit and test charges, the ones that were there already, and what was skipped. */
public record ImportResult(LocalDate day, int visits, int tests, int alreadyImported, List<String> skipped) {}
