package com.medilab.sample;

import java.time.LocalDateTime;
import java.util.List;

/** What the acceptance desk sees after scanning a tube: the tube, its request and the tests done on it. */
public record SampleView(
        String barcode,
        String sampleType,
        String status,
        LocalDateTime acceptedAt,
        String rejectReason,
        String replacedBy,
        String orderId,
        String orderStatus,
        String patientName,
        String fiscalCode,
        boolean urgent,
        List<String> examCodes) {}
