package com.medibill.integration;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

/** MediLab for the tests: the requests reported on some days (as its OrderView has them), no HTTP. */
@Component
@Primary
public class FakeMediLabClient implements MediLabClient {

    public final Map<LocalDate, List<LabOrderInfo>> reported = new HashMap<>();

    public FakeMediLabClient() {
        reset();
    }

    public void reset() {
        reported.clear();
        reported.put(LocalDate.of(2026, 11, 2), new ArrayList<>(List.of(new LabOrderInfo("RL-2026-00055", "BNCLRA85C45L219Y", "Bianchi Laura", "REFERTATA",
                LocalDateTime.of(2026, 11, 2, 12, 40), List.of(exam("HB", "90.62.2"), exam("GLU", "90.27.1"), exam("TSH", "90.42.1"))))));
        reported.put(LocalDate.of(2026, 11, 3), new ArrayList<>(List.of(new LabOrderInfo("RL-2026-00052", "MRNPLA61S03C351V", "Marino Paolo", "REFERTATA",
                LocalDateTime.of(2026, 11, 3, 14, 5), List.of(exam("CREA", "90.16.3"), exam("GLU", "90.27.1"), exam("HBA1C", "90.28.1"), exam("K", "90.37.4"), exam("UREA", "90.44.1"))))));
    }

    public static LabOrderInfo.Exam exam(String code, String tariffCode) {
        return new LabOrderInfo.Exam(code, code, tariffCode);
    }

    @Override
    public List<LabOrderInfo> reportedOrders(LocalDate day) {
        return List.copyOf(reported.getOrDefault(day, List.of()));
    }
}
