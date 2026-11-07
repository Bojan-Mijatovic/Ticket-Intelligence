package com.medibill.receipt;

import com.medibill.charge.Charge;
import com.medibill.charge.ChargeRepository;
import com.medibill.common.ConflictException;
import com.medibill.common.NotFoundException;
import com.medibill.exemption.Exemption;
import com.medibill.exemption.ExemptionService;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Receipts: every open charge of a patient goes on one receipt. A charge is free when an exemption of the patient,
 * valid on the day of the service, covers its tariff; the co-pay is what is left, at most CAP per receipt.
 */
@Service
public class ReceiptService {

    /** The regional maximum co-pay of a receipt (euro). */
    public static final BigDecimal CAP = new BigDecimal("36.15");

    private final ReceiptRepository receipts;
    private final ChargeRepository charges;
    private final ExemptionService exemptions;

    public ReceiptService(ReceiptRepository receipts, ChargeRepository charges, ExemptionService exemptions) {
        this.receipts = receipts;
        this.charges = charges;
        this.exemptions = exemptions;
    }

    @Transactional
    public ReceiptView issue(ReceiptRequest request) {
        List<Charge> open = charges.findByFiscalCodeIgnoreCaseAndStatusOrderByServiceDateAscIdAsc(request.fiscalCode(), Charge.APERTO);
        if (open.isEmpty()) throw new ConflictException("charges: no open charges for " + request.fiscalCode());

        Set<String> usedExemptions = new TreeSet<>();
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal exempt = BigDecimal.ZERO;
        for (Charge c : open) {
            total = total.add(c.getAmount());
            Exemption cover = coverOf(c);
            if (cover != null) {
                exempt = exempt.add(c.getAmount());
                usedExemptions.add(cover.getCode());
            }
        }
        BigDecimal copay = total.subtract(exempt).min(CAP);

        LocalDateTime now = LocalDateTime.now();
        String id = String.format("RC-%d-%05d", now.getYear(), receipts.nextNumber());
        Receipt receipt = receipts.save(Receipt.issue(id, open.get(0).getFiscalCode(), open.get(0).getPatientName(), total, exempt, copay, String.join(",", usedExemptions), now));
        open.forEach(c -> c.putOn(id));
        return view(receipt);
    }

    @Transactional(readOnly = true)
    public List<ReceiptView> list(String status) {
        return receipts.findAllByOrderByIssuedAtDesc().stream()
                .filter(r -> status == null || status.isBlank() || status.equalsIgnoreCase(r.getStatus()))
                .map(this::view)
                .toList();
    }

    @Transactional(readOnly = true)
    public ReceiptView get(String id) {
        return view(find(id));
    }

    @Transactional
    public ReceiptView pay(String id) {
        Receipt r = find(id);
        r.pay(LocalDateTime.now());
        return view(r);
    }

    /** Cancels an unpaid receipt: its charges are open again (to correct them and issue a new receipt). */
    @Transactional
    public ReceiptView storno(String id) {
        Receipt r = find(id);
        r.storno();
        charges.findByReceiptIdOrderByServiceDateAscIdAsc(id).forEach(Charge::release);
        return view(r);
    }

    private Receipt find(String id) {
        return receipts.findById(id).orElseThrow(() -> new NotFoundException("Receipt", id));
    }

    /** The exemption that makes this charge free: valid on the day of the service and covering its tariff. */
    private Exemption coverOf(Charge c) {
        return exemptions.validOn(c.getFiscalCode(), c.getServiceDate()).stream().filter(e -> e.covers(c.getTariffCode())).findFirst().orElse(null);
    }

    private ReceiptView view(Receipt r) {
        List<ReceiptView.Line> lines = charges.findByReceiptIdOrderByServiceDateAscIdAsc(r.getId()).stream()
                .map(c -> new ReceiptView.Line(c.getId(), c.getServiceDate(), c.getSource(), c.getTariffCode(), c.getDescription(), c.getAmount(), coverOf(c) != null))
                .toList();
        return new ReceiptView(r.getId(), r.getFiscalCode(), r.getPatientName(), r.getIssuedAt(), r.getTotal(), r.getExempt(), r.getCopay(),
                r.getExemptionCodes(), r.getStatus(), r.getPaidAt(), lines);
    }
}
