package com.medilab.sample;

import com.medilab.catalog.Exam;
import com.medilab.catalog.ExamRepository;
import com.medilab.common.ConflictException;
import com.medilab.common.NotFoundException;
import com.medilab.order.LabOrder;
import com.medilab.order.LabOrderRepository;
import java.time.LocalDateTime;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The acceptance desk ("accettazione campioni"): every tube is scanned, then accepted or rejected. */
@Service
public class SampleService {

    private final SampleRepository samples;
    private final LabOrderRepository orders;
    private final ExamRepository exams;

    public SampleService(SampleRepository samples, LabOrderRepository orders, ExamRepository exams) {
        this.samples = samples;
        this.orders = orders;
        this.exams = exams;
    }

    @Transactional(readOnly = true)
    public SampleView get(String barcode) {
        return view(find(barcode));
    }

    /** Accepted: when no tube of the request is still waiting, the laboratory starts working on it. */
    @Transactional
    public SampleView accept(String barcode) {
        Sample sample = find(barcode);
        LabOrder order = order(sample);
        if (!order.isOpen()) {
            throw new ConflictException("status: request " + order.getId() + " is " + order.getStatus() + ", its samples cannot be accepted");
        }
        sample.accept(LocalDateTime.now());
        boolean waiting = samples.findByOrderIdOrderByBarcodeAsc(order.getId()).stream().anyMatch(s -> Sample.ATTESO.equals(s.getStatus()));
        if (!waiting) order.startWork();
        return view(sample);
    }

    /** Rejected (haemolysed, clotted, too little, wrong label): a new tube with a new barcode replaces it. */
    @Transactional
    public SampleView reject(String barcode, RejectRequest request) {
        Sample sample = find(barcode);
        sample.reject(request.reason());
        Sample replacement = samples.save(Sample.waiting(samples.nextBarcode(), sample.getOrderId(), sample.getSampleType()));
        sample.replaceWith(replacement.getBarcode());
        return view(sample);
    }

    private Sample find(String barcode) {
        return samples.findById(barcode).orElseThrow(() -> new NotFoundException("Sample", barcode));
    }

    private LabOrder order(Sample sample) {
        return orders.findById(sample.getOrderId()).orElseThrow(() -> new NotFoundException("Request", sample.getOrderId()));
    }

    private SampleView view(Sample s) {
        LabOrder o = order(s);
        List<String> examCodes = exams.findAllById(o.getExamCodes()).stream()
                .filter(e -> e.getSampleType().equals(s.getSampleType()))
                .map(Exam::getCode).sorted().toList();
        return new SampleView(s.getBarcode(), s.getSampleType(), s.getStatus(), s.getAcceptedAt(), s.getRejectReason(), s.getReplacedBy(),
                o.getId(), o.getStatus(), o.getPatientName(), o.getFiscalCode(), o.isUrgent(), examCodes);
    }
}
