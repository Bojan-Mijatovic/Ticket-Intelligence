package com.medilab.result;

import com.medilab.catalog.Exam;
import com.medilab.catalog.ExamRepository;
import com.medilab.common.BadRequestException;
import com.medilab.common.ConflictException;
import com.medilab.common.NotFoundException;
import com.medilab.order.LabOrder;
import com.medilab.order.LabOrderRepository;
import com.medilab.order.OrderStatus;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Results of a request: entered (and flagged) while it is IN_LAVORAZIONE, then validated into the report. */
@Service
public class ResultService {

    private final ResultRepository results;
    private final LabOrderRepository orders;
    private final ExamRepository exams;

    public ResultService(ResultRepository results, LabOrderRepository orders, ExamRepository exams) {
        this.results = results;
        this.orders = orders;
        this.exams = exams;
    }

    @Transactional(readOnly = true)
    public ResultSheet sheet(String orderId) {
        return sheet(order(orderId));
    }

    /** Saves (or corrects) values; the flag is computed with the range for the patient's sex. */
    @Transactional
    public ResultSheet save(String orderId, List<ResultEntry> entries) {
        LabOrder order = order(orderId);
        if (!OrderStatus.IN_LAVORAZIONE.equals(order.getStatus())) {
            throw new ConflictException("status: results can be entered only for a request " + OrderStatus.IN_LAVORAZIONE + " (" + orderId + " is " + order.getStatus() + ")");
        }
        Map<String, Exam> catalog = catalog(order);
        Map<String, Result> saved = results.findByOrderId(orderId).stream().collect(Collectors.toMap(Result::getExamCode, Function.identity()));
        LocalDateTime now = LocalDateTime.now();
        for (ResultEntry entry : entries) {
            String code = entry.examCode().toUpperCase();
            Exam exam = catalog.get(code);
            if (exam == null) throw new BadRequestException("examCode: " + code + " is not a test of request " + orderId);
            BigDecimal value = entry.value().setScale(exam.getDecimals(), java.math.RoundingMode.HALF_UP);
            Result result = saved.computeIfAbsent(code, c -> Result.of(orderId, c));
            result.set(value, exam.getUnit(), Flags.flag(exam, order.getSex(), value), now);
            results.save(result);
        }
        return sheet(order);
    }

    /** Validation: every test needs a value; then the request is REFERTATA and the report can be printed. */
    @Transactional
    public ResultSheet validate(String orderId, ValidateRequest request) {
        LabOrder order = order(orderId);
        List<Result> list = results.findByOrderId(orderId);
        List<String> missing = order.getExamCodes().stream()
                .filter(code -> list.stream().noneMatch(r -> r.getExamCode().equals(code) && r.getValue() != null))
                .sorted().toList();
        if (!missing.isEmpty()) throw new ConflictException("results: no value yet for " + String.join(", ", missing));
        LocalDateTime now = LocalDateTime.now();
        list.forEach(r -> r.validate(request.validatedBy().trim(), now));
        order.report(now);
        return sheet(order);
    }

    /** The report: only for a REFERTATA request. */
    @Transactional(readOnly = true)
    public ResultSheet report(String orderId) {
        LabOrder order = order(orderId);
        if (!OrderStatus.REFERTATA.equals(order.getStatus())) throw new ConflictException("status: request " + orderId + " has no report yet (" + order.getStatus() + ")");
        return sheet(order);
    }

    /** Validated results of a patient, newest first; `examCode` is optional. For MediFarma and the other apps. */
    @Transactional(readOnly = true)
    public List<PatientResult> ofPatient(String fiscalCode, String examCode) {
        Map<String, LabOrder> byId = orders.findByFiscalCodeIgnoreCase(fiscalCode).stream().collect(Collectors.toMap(LabOrder::getId, Function.identity()));
        Map<String, Exam> catalog = exams.findAll().stream().collect(Collectors.toMap(Exam::getCode, Function.identity()));
        return results.findByOrderIdInAndValidatedTrue(byId.keySet()).stream()
                .filter(r -> examCode == null || examCode.isBlank() || examCode.equalsIgnoreCase(r.getExamCode()))
                .map(r -> new PatientResult(r.getOrderId(), r.getExamCode(), catalog.get(r.getExamCode()).getName(), r.getValue(), r.getUnit(), r.getFlag(),
                        byId.get(r.getOrderId()).getReportedAt()))
                .sorted(Comparator.comparing(PatientResult::reportedAt, Comparator.nullsLast(Comparator.reverseOrder())))
                .toList();
    }

    private LabOrder order(String id) {
        return orders.findById(id).orElseThrow(() -> new NotFoundException("Request", id));
    }

    private Map<String, Exam> catalog(LabOrder order) {
        return exams.findAllById(order.getExamCodes()).stream().collect(Collectors.toMap(Exam::getCode, Function.identity()));
    }

    private ResultSheet sheet(LabOrder order) {
        Map<String, Exam> catalog = catalog(order);
        Map<String, Result> saved = results.findByOrderId(order.getId()).stream().collect(Collectors.toMap(Result::getExamCode, Function.identity()));
        List<ResultSheet.Row> rows = order.getExamCodes().stream()
                .map(catalog::get)
                .sorted(Comparator.comparing(Exam::getSampleType).thenComparing(Exam::getCode))
                .map(e -> {
                    BigDecimal[] range = Flags.range(e, order.getSex());
                    Result r = saved.get(e.getCode());
                    return new ResultSheet.Row(e.getCode(), e.getName(), e.getSampleType(), r != null && r.getUnit() != null ? r.getUnit() : e.getUnit(),
                            e.getDecimals(), range[0], range[1], r == null ? null : r.getValue(), r == null ? null : r.getFlag());
                })
                .toList();
        String validatedBy = saved.values().stream().filter(Result::isValidated).map(Result::getValidatedBy).findFirst().orElse(null);
        return new ResultSheet(order.getId(), order.getStatus(), order.getPatientName(), order.getFiscalCode(), order.getSex(), order.getBirthDate(),
                order.getPrescriber(), order.getRequestedAt(), order.getReportedAt(), validatedBy, rows);
    }
}
