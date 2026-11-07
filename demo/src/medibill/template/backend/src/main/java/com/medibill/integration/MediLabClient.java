package com.medibill.integration;

import java.time.LocalDate;
import java.util.List;

/** MediLab, the laboratory application: the requests reported on a day, to charge their tests. */
public interface MediLabClient {

    /** GET /api/orders?status=REFERTATA&from=day&to=day of MediLab. */
    List<LabOrderInfo> reportedOrders(LocalDate day);
}
