package com.medilab.order;

import com.medilab.catalog.Exam;
import com.medilab.catalog.ExamRepository;
import com.medilab.common.BadRequestException;
import com.medilab.common.NotFoundException;
import com.medilab.integration.MediAgendaClient;
import com.medilab.integration.PatientInfo;
import com.medilab.sample.Sample;
import com.medilab.sample.SampleRepository;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Test requests: created for a MediAgenda patient, with one sample (tube) per sample type of the chosen tests. */
@Service
public class OrderService {

    private final LabOrderRepository orders;
    private final ExamRepository exams;
    private final SampleRepository samples;
    private final MediAgendaClient mediAgenda;

    public OrderService(LabOrderRepository orders, ExamRepository exams, SampleRepository samples, MediAgendaClient mediAgenda) {
        this.orders = orders;
        this.exams = exams;
        this.samples = samples;
        this.mediAgenda = mediAgenda;
    }

    @Transactional
    public OrderView create(OrderRequest request) {
        PatientInfo patient = mediAgenda.patient(request.patientId())
                .orElseThrow(() -> new BadRequestException("patientId: patient " + request.patientId() + " is not in the MediAgenda registry"));
        // The same test can come from a profile and be ticked by hand as well: it is done (and charged) once.
        List<String> codes = request.examCodes().stream().map(c -> c.trim().toUpperCase(Locale.ROOT)).distinct().toList();
        Map<String, Exam> catalog = exams.findAllById(codes).stream().filter(Exam::isActive).collect(Collectors.toMap(Exam::getCode, Function.identity()));
        List<String> unknown = codes.stream().filter(c -> !catalog.containsKey(c)).toList();
        if (!unknown.isEmpty()) throw new BadRequestException("examCodes: not in the catalog: " + String.join(", ", unknown));

        LocalDateTime now = LocalDateTime.now();
        String id = String.format("RL-%d-%05d", now.getYear(), orders.nextNumber());
        LabOrder order = orders.save(LabOrder.create(id, patient, request, codes, now));
        codes.stream().map(c -> catalog.get(c).getSampleType()).distinct()
                .forEach(type -> samples.save(Sample.waiting(samples.nextBarcode(), order.getId(), type)));
        return view(order);
    }

    @Transactional(readOnly = true)
    public OrderView get(String id) {
        return view(find(id));
    }

    /**
     * Newest first. `status` and `q` (patient name or fiscal code) are optional; `from`/`to` (inclusive) filter on
     * the report date, for MediBill's daily import of reported requests.
     */
    @Transactional(readOnly = true)
    public List<OrderView> list(String status, String q, LocalDate from, LocalDate to) {
        String term = q == null ? "" : q.trim().toLowerCase(Locale.ROOT);
        return orders.findAllByOrderByRequestedAtDesc().stream()
                .filter(o -> status == null || status.isBlank() || status.equalsIgnoreCase(o.getStatus()))
                .filter(o -> term.isEmpty() || o.getPatientName().toLowerCase(Locale.ROOT).contains(term) || o.getFiscalCode().toLowerCase(Locale.ROOT).contains(term))
                .filter(o -> from == null || (o.getReportedAt() != null && !o.getReportedAt().toLocalDate().isBefore(from)))
                .filter(o -> to == null || (o.getReportedAt() != null && !o.getReportedAt().toLocalDate().isAfter(to)))
                .map(this::view)
                .toList();
    }

    @Transactional
    public OrderView cancel(String id, CancelRequest request) {
        LabOrder order = find(id);
        order.cancel(request.reason());
        samples.findByOrderIdOrderByBarcodeAsc(id).forEach(Sample::cancel);
        return view(order);
    }

    LabOrder find(String id) {
        return orders.findById(id).orElseThrow(() -> new NotFoundException("Request", id));
    }

    OrderView view(LabOrder o) {
        Map<String, Exam> catalog = exams.findAllById(o.getExamCodes()).stream().collect(Collectors.toMap(Exam::getCode, Function.identity()));
        List<OrderView.ExamRef> examRefs = o.getExamCodes().stream().sorted()
                .map(c -> catalog.get(c))
                .map(e -> new OrderView.ExamRef(e.getCode(), e.getName(), e.getSampleType(), e.getTariffCode()))
                .toList();
        List<OrderView.SampleRef> sampleRefs = samples.findByOrderIdOrderByBarcodeAsc(o.getId()).stream()
                .map(s -> new OrderView.SampleRef(s.getBarcode(), s.getSampleType(), s.getStatus()))
                .toList();
        return new OrderView(o.getId(), o.getPatientId(), o.getFiscalCode(), o.getPatientName(), o.getSex(), o.getBirthDate(),
                o.getPrescriber(), o.getPrescriptionCode(), o.isUrgent(), o.getStatus(), o.getRequestedAt(), o.getReportedAt(),
                o.getCancelReason(), examRefs, sampleRefs);
    }
}
